import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { applyThemeVars, effectiveTheme } from '@/utils/format'
import {
  PDF_ENGINE_CAPABILITIES,
  type ContentTapEvent,
  type ReaderEngine,
  type SearchOptions,
  type SelectionCaptureEvent,
} from './types'
import { createCurlGate, createHostSelectionBridge, createSearchHighlightState } from './shared'
import { suppressHostCaret } from '@/utils/suppressCaret'
import { selectionRectFromSel } from '@/utils/selectionToolbar'
import { highlightAnnotInRoot } from '@/utils/domHighlight'
import { isSparseText, recognizeImage } from '@/utils/offlineOcr'
import { compactCjkGaps, indexOfFlexible } from '@/utils/searchText'

/**
 * Same-origin worker (copied to dist/public by vite plugin).
 * Avoids CDN latency on mobile networks.
 */
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`

export class PdfEngine implements ReaderEngine {
  readonly capabilities = PDF_ENGINE_CAPABILITIES
  private pdf: PDFDocumentProxy | null = null
  private container: HTMLElement | null = null
  private pagesEl: HTMLElement | null = null
  private page = 1
  private settings: ReaderSettings | null = null
  private progressCb: ((p: { locator: Locator; percent: number }) => void) | null = null
  private wheelCb: ((deltaY: number) => void) | null = null
  private userZoom = 1
  private pdfQuality: 'smooth' | 'hd' = 'smooth'
  private rendering = false
  private toc: TocItem[] = []
  private scrollTimer: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private resizeTimer: number | null = null
  private lastRenderKey = ''
  private pageTurn: PageTurnMode = 'slide'
  private selectionCb: ((e: SelectionCaptureEvent | null) => void) | null = null
  private readonly curl = createCurlGate()
  private readonly searchHl = createSearchHighlightState()
  private selectionBridge = createHostSelectionBridge({
    getRoot: () => this.pagesEl,
    capture: () => this.captureSelection(),
    onEmit: (ev) => this.selectionCb?.(ev),
  })
  /** Cached page plain text for search (built lazily / incrementally). */
  private textCache = new Map<number, string>()
  private textLayerGen = 0
  /** Measured CSS heights per page — keep scroll stable when unloading canvases. */
  private pageHeights = new Map<number, number>()
  private defaultPageHeight = 900
  /** A = no destructive evict; B = unload canvas but keep slots (default after fix). */
  private virtualize = true
  private annots: AnnotationRecord[] = []
  /** Pages whose textCache entry came from OCR. */
  private ocrPages = new Set<number>()
  private needsOcrCache: boolean | null = null
  /** Soft cap so mobile OCR does not run forever on huge scans. */
  private static readonly OCR_PAGE_CAP = 80

  async open(blob: Blob, settings: ReaderSettings, container: HTMLElement) {
    this.destroy()
    this.container = container
    this.settings = settings
    this.pageTurn = settings.pageTurn
    this.userZoom = clampPdfZoom(settings.pdfZoom ?? 1)
    this.pdfQuality = settings.pdfQuality === 'hd' ? 'hd' : 'smooth'
    container.innerHTML = ''
    container.className = 'pdf-reader'
    applyThemeVars(container, effectiveTheme(settings), settings)

    const data = await blob.arrayBuffer()
    this.pdf = await pdfjs.getDocument({ data }).promise
    this.page = 1

    const pages = document.createElement('div')
    pages.className = 'pdf-pages'
    container.appendChild(pages)
    this.pagesEl = pages
    pages.addEventListener('scroll', this.onScroll, { passive: true })
    pages.addEventListener('wheel', this.onWheelEvent, { passive: false })
    this.selectionBridge.bind(pages)
    suppressHostCaret(pages)
    this.observeResize(pages)
    this.applyPageTurnChrome()

    await this.renderVisible(true)
    this.scrollToPage(this.page)
    this.emitProgress()
    void this.loadOutline()
  }

  private applyPageTurnChrome() {
    if (!this.pagesEl) return
    this.pagesEl.dataset.turn = this.pageTurn
    if (this.pageTurn === 'scroll') {
      this.pagesEl.style.overflowY = 'auto'
      this.pagesEl.style.scrollBehavior = 'smooth'
    } else {
      // 横滑 / 仿真：整页锁定，不自由纵滑
      this.pagesEl.style.overflowY = 'hidden'
      this.pagesEl.style.scrollBehavior = 'auto'
    }
  }

  private async loadOutline() {
    if (!this.pdf) return
    try {
      const outline = await this.pdf.getOutline()
      this.toc = outline?.length ? await mapPdfOutline(this.pdf, outline) : []
    } catch {
      this.toc = []
    }
  }

  destroy() {
    this.textLayerGen += 1
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.selectionBridge.destroy()
    if (this.pagesEl) {
      this.pagesEl.removeEventListener('scroll', this.onScroll)
      this.pagesEl.removeEventListener('wheel', this.onWheelEvent)
    }
    this.selectionCb = null
    this.textCache.clear()
    this.ocrPages.clear()
    this.needsOcrCache = null
    this.pageHeights.clear()
    this.pdf?.destroy()
    this.pdf = null
    if (this.container) this.container.innerHTML = ''
    this.container = null
    this.pagesEl = null
    this.lastRenderKey = ''
  }

  applySettings(settings: ReaderSettings) {
    const prevZoom = this.userZoom
    const prevQuality = this.pdfQuality
    const prevTurn = this.pageTurn
    this.settings = settings
    this.pageTurn = settings.pageTurn
    this.userZoom = clampPdfZoom(settings.pdfZoom ?? 1)
    this.pdfQuality = settings.pdfQuality === 'hd' ? 'hd' : 'smooth'
    if (this.container) {
      applyThemeVars(this.container, effectiveTheme(settings), settings)
    }
    this.applyPageTurnChrome()
    const zoomChanged = Math.abs(prevZoom - this.userZoom) > 0.001
    const qualityChanged = prevQuality !== this.pdfQuality
    const turnChanged = prevTurn !== this.pageTurn
    if (zoomChanged || qualityChanged || turnChanged) {
      void this.renderVisible(true).then(() => {
        if (this.pageTurn !== 'scroll') this.scrollToPage(this.page)
      })
    } else if (this.pageTurn !== 'scroll') {
      this.scrollToPage(this.page)
    }
  }

  getToc() {
    return this.toc.length
      ? this.toc
      : Array.from({ length: this.pdf?.numPages || 0 }, (_, i) => ({
          id: `p${i + 1}`,
          label: `第 ${i + 1} 页`,
          locator: { type: 'pdf' as const, page: i + 1, yRatio: 0 },
        }))
  }

  getProgress() {
    const total = this.pdf?.numPages || 1
    if (this.pageTurn === 'scroll' && this.pagesEl) {
      const yRatio =
        this.pagesEl.scrollTop /
        Math.max(1, this.pagesEl.scrollHeight - this.pagesEl.clientHeight)
      return {
        locator: { type: 'pdf' as const, page: this.page, yRatio },
        percent: yRatio * 100,
      }
    }
    return {
      locator: { type: 'pdf' as const, page: this.page, yRatio: 0 },
      percent: total <= 1 ? 0 : ((this.page - 1) / (total - 1)) * 100,
    }
  }

  async goTo(locator: Locator) {
    if (locator.type !== 'pdf' || !this.pdf || !this.pagesEl) return
    // Cancel pending scroll-driven render so it cannot fight this jump
    if (this.scrollTimer) {
      window.clearTimeout(this.scrollTimer)
      this.scrollTimer = null
    }
    await this.waitForRenderIdle()

    const page = Math.min(this.pdf.numPages, Math.max(1, locator.page || 1))
    this.page = page
    // Do NOT force-rebuild slots — that is slow and was fighting scroll jumps
    await this.renderVisible(false)
    await yieldToMain()
    this.scrollToPage(page, locator.yRatio || 0)
    // Second pass after layout settles (slot heights may update once canvas paints)
    await yieldToMain()
    this.scrollToPage(page, locator.yRatio || 0)
    this.emitProgress()
    if (this.searchHl.get()) this.highlightSearch(this.searchHl.get())
  }

  highlightSearch(query: string | null) {
    this.searchHl.set(query)
    if (!this.pagesEl) return
    this.searchHl.clearRoot(this.pagesEl)
    if (!this.searchHl.get()) return
    const layers = this.pagesEl.querySelectorAll('.pdf-text-layer, .pdf-page')
    this.searchHl.applyRoots(layers, true)
  }

  async goToPercent(percent: number) {
    if (!this.pdf) return
    const page = Math.min(
      this.pdf.numPages,
      Math.max(1, Math.round((Math.min(100, Math.max(0, percent)) / 100) * this.pdf.numPages) || 1),
    )
    await this.goTo({ type: 'pdf', page, yRatio: 0 })
  }

  async next() {
    if (!this.pdf) return
    const pdf = this.pdf
    // 上下滑动：按钮/程序调用 = 滚一屏；横滑/仿真 = 整页切换
    if (this.pageTurn === 'scroll' && this.pagesEl) {
      const el = this.pagesEl
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
      if (!atBottom) {
        el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'smooth' })
        this.emitProgress()
        return
      }
      if (this.page < pdf.numPages) {
        this.page++
        await this.renderVisible(false)
        this.scrollToPage(this.page)
        this.emitProgress()
      }
      return
    }
    if (this.page >= pdf.numPages) return
    await this.curl.run(this.pageTurn, this.container, 'next', async () => {
      this.page++
      await this.renderVisible(false)
      this.scrollToPage(this.page)
      this.emitProgress()
    })
  }

  async prev() {
    if (!this.pdf) return
    if (this.pageTurn === 'scroll' && this.pagesEl) {
      if (this.pagesEl.scrollTop > 8) {
        this.pagesEl.scrollBy({ top: -this.pagesEl.clientHeight * 0.9, behavior: 'smooth' })
        this.emitProgress()
        return
      }
      if (this.page > 1) {
        this.page--
        await this.renderVisible(false)
        this.scrollToPage(this.page)
        this.emitProgress()
      }
      return
    }
    if (this.page <= 1) return
    await this.curl.run(this.pageTurn, this.container, 'prev', async () => {
      this.page--
      await this.renderVisible(false)
      this.scrollToPage(this.page)
      this.emitProgress()
    })
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    if (!this.pdf || !query.trim()) return []
    const q = query.trim()
    const hits: SearchHit[] = []
    const total = this.pdf.numPages
    const ocr = Boolean(opts?.ocr)
    const ocrLimit = Math.min(total, PdfEngine.OCR_PAGE_CAP)
    // Batch with yields so the UI stays responsive on large PDFs
    for (let p = 1; p <= total && hits.length < 40; p++) {
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const useOcr = ocr && p <= ocrLimit
      if (useOcr) opts?.onOcrProgress?.({ page: p, total: ocrLimit })
      else opts?.onSearchProgress?.({ page: p, total })
      let text: string
      try {
        text = await this.getPageText(p, useOcr, opts?.signal)
      } catch (err) {
        if (opts?.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          throw new DOMException('Aborted', 'AbortError')
        }
        throw err
      }
      let idx = 0
      let pageAdded = false
      while (hits.length < 40) {
        const found = indexOfFlexible(text, q, idx)
        if (found < 0) break
        hits.push({
          snippet: `…${text.slice(Math.max(0, found - 16), found + q.length + 24)}…`,
          locator: { type: 'pdf', page: p, yRatio: 0 },
        })
        pageAdded = true
        idx = found + Math.max(1, q.replace(/\s+/g, '').length)
      }
      // Stream hits as soon as this page contributes (or every few pages for progress)
      if (pageAdded || p === 1 || p % 5 === 0 || p === total) {
        opts?.onHits?.(hits.slice())
      }
      if (p % 2 === 0) await yieldToMain()
    }
    opts?.onHits?.(hits.slice())
    return hits
  }

  async probeNeedsOcr(): Promise<boolean> {
    if (this.needsOcrCache != null) return this.needsOcrCache
    if (!this.pdf) return false
    const sample = Math.min(3, this.pdf.numPages)
    let chars = 0
    let cjk = 0
    for (let p = 1; p <= sample; p++) {
      const t = await this.getEmbeddedText(p)
      const compact = t.replace(/\s+/g, '')
      chars += compact.length
      cjk += (compact.match(/[\u3400-\u9FFF]/g) || []).join('').length
    }
    // Sparse, or lots of glyphs but almost no CJK (CID / garbage fonts) → OCR helps
    this.needsOcrCache = chars < 40 || (chars >= 40 && cjk < Math.min(20, chars * 0.15))
    return this.needsOcrCache
  }

  onProgress(cb: (p: { locator: Locator; percent: number }) => void) {
    this.progressCb = cb
  }

  onWheel(cb: (deltaY: number) => void) {
    this.wheelCb = cb
  }

  onContentTap(_cb: (e: ContentTapEvent) => void) {
    // PDF uses host stage click zones.
  }

  onSelection(cb: (e: SelectionCaptureEvent | null) => void) {
    this.selectionCb = cb
  }

  applyAnnotations(annots: AnnotationRecord[]) {
    this.annots = annots
    if (!this.pagesEl) return
    this.pagesEl.querySelectorAll('.pdf-bookmark-flag').forEach((n) => n.remove())
    this.pagesEl.querySelectorAll('mark.annot').forEach((n) => {
      const parent = n.parentNode
      if (!parent) return
      parent.replaceChild(document.createTextNode(n.textContent || ''), n)
      parent.normalize()
    })
    for (const a of annots) {
      if (a.locator.type !== 'pdf') continue
      const pageEl = this.pagesEl.querySelector(`[data-page="${a.locator.page}"]`) as HTMLElement | null
      if (!pageEl) continue
      if (a.type === 'bookmark') {
        const flag = document.createElement('div')
        flag.className = 'pdf-bookmark-flag'
        flag.textContent = '书签'
        pageEl.appendChild(flag)
      } else if ((a.type === 'highlight' || a.type === 'note') && a.selectedText) {
        const layer = pageEl.querySelector('.pdf-text-layer') as HTMLElement | null
        if (layer) highlightAnnotInRoot(layer, a.selectedText, a.color)
      }
    }
  }

  getSelectableText() {
    const layer = this.pagesEl?.querySelector(`[data-page="${this.page}"] .pdf-text-layer`)
    const fromLayer = layer?.textContent?.trim()
    if (fromLayer) return fromLayer
    return window.getSelection()?.toString().trim() || ''
  }

  captureSelection() {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!text || !sel) return null
    if (this.pagesEl && sel.anchorNode && !this.pagesEl.contains(sel.anchorNode)) return null
    const anchorEl =
      sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
    const pageEl = anchorEl?.closest('[data-page]') as HTMLElement | null
    const pageNum = pageEl ? Number(pageEl.dataset.page) || this.page : this.page
    let yRatio = 0
    const rect = selectionRectFromSel(sel)
    if (pageEl && rect) {
      const pr = pageEl.getBoundingClientRect()
      const h = Math.max(1, pr.height)
      yRatio = Math.min(1, Math.max(0, (rect.top - pr.top) / h))
    }
    return {
      text,
      locator: { type: 'pdf' as const, page: pageNum, yRatio },
      rect: rect ?? undefined,
    }
  }

  private observeResize(el: HTMLElement) {
    this.resizeObserver?.disconnect()
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) window.clearTimeout(this.resizeTimer)
      this.resizeTimer = window.setTimeout(() => {
        void this.renderVisible(true)
      }, 180)
    })
    this.resizeObserver.observe(el)
  }

  private getRenderMetrics(pageWidthAtScale1: number, pageHeightAtScale1: number) {
    const padding = 24
    const containerWidth = Math.max(
      200,
      (this.pagesEl?.clientWidth || this.container?.clientWidth || 800) - padding,
    )
    const containerHeight = Math.max(
      200,
      (this.pagesEl?.clientHeight || this.container?.clientHeight || 600) - padding,
    )
    let fitScale = (containerWidth / Math.max(1, pageWidthAtScale1)) * this.userZoom
    // 横滑 / 仿真：整页落入视口，一文件页 = 一屏
    if (this.pageTurn !== 'scroll') {
      const heightScale = (containerHeight / Math.max(1, pageHeightAtScale1)) * this.userZoom
      fitScale = Math.min(fitScale, heightScale)
    }
    const native = Math.max(window.devicePixelRatio || 1, 1)
    const dpr = Math.min(native, maxDprForQuality(this.pdfQuality))
    return { fitScale: Math.max(0.35, fitScale), dpr }
  }

  private renderKey(fitScale: number, dpr: number) {
    return `${fitScale.toFixed(3)}_${dpr.toFixed(2)}_${this.userZoom}_${this.pdfQuality}_${this.pageTurn}`
  }

  private prefetchRange() {
    const total = this.pdf?.numPages || 1
    const pad = this.pdfQuality === 'hd' ? 2 : 1
    return {
      start: Math.max(1, this.page - pad),
      end: Math.min(total, this.page + pad),
    }
  }

  private slotHeight(pageNum: number) {
    return this.pageHeights.get(pageNum) || this.defaultPageHeight
  }

  /** Create/update one slot per page so document height stays stable while scrolling. */
  private ensureSlots() {
    if (!this.pdf || !this.pagesEl) return
    const total = this.pdf.numPages
    const existing = this.pagesEl.querySelectorAll('.pdf-page')
    if (existing.length === total) {
      for (const el of existing) {
        const n = Number((el as HTMLElement).dataset.page)
        if (!(el as HTMLElement).dataset.filled) {
          ;(el as HTMLElement).style.minHeight = `${this.slotHeight(n)}px`
        }
      }
      return
    }
    const frag = document.createDocumentFragment()
    for (let i = 1; i <= total; i++) {
      const slot = document.createElement('div')
      slot.className = 'pdf-page pdf-slot'
      slot.dataset.page = String(i)
      slot.style.minHeight = `${this.slotHeight(i)}px`
      frag.appendChild(slot)
    }
    this.pagesEl.innerHTML = ''
    this.pagesEl.appendChild(frag)
  }

  private async getEmbeddedText(pageNum: number): Promise<string> {
    if (!this.pdf) return ''
    const page = await this.pdf.getPage(pageNum)
    const tc = await page.getTextContent()
    // Join items without extra spaces — PDF.js already spaces glyphs for CJK often
    const raw = tc.items.map((it) => ('str' in it ? it.str : '')).join('')
    return compactCjkGaps(raw)
  }

  private async getPageText(pageNum: number, allowOcr = false, signal?: AbortSignal): Promise<string> {
    const cached = this.textCache.get(pageNum)
    if (cached != null && (!allowOcr || this.ocrPages.has(pageNum) || !isSparseText(cached))) {
      return cached
    }
    if (!this.pdf) return ''
    const embedded = cached ?? (await this.getEmbeddedText(pageNum))
    if (!allowOcr || !isSparseText(embedded)) {
      this.textCache.set(pageNum, embedded)
      return embedded
    }
    try {
      const ocrText = await this.ocrPage(pageNum, signal)
      const text = ocrText || embedded
      this.textCache.set(pageNum, text)
      this.ocrPages.add(pageNum)
      return text
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new DOMException('Aborted', 'AbortError')
      }
      console.warn('OCR page failed', pageNum, err)
      this.textCache.set(pageNum, embedded)
      return embedded
    }
  }

  private async ocrPage(pageNum: number, signal?: AbortSignal): Promise<string> {
    if (!this.pdf) return ''
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await this.pdf.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    // Target ~1800px width so Tesseract gets usable line height (avoids 1×N scale errors)
    const scale = Math.min(3, Math.max(1.8, 1800 / Math.max(1, base.width)))
    const viewport = page.getViewport({ scale })
    const w = Math.max(1, Math.floor(viewport.width))
    const h = Math.max(1, Math.floor(viewport.height))
    if (w < 64 || h < 64) return ''

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!ctx) return ''
    canvas.width = w
    canvas.height = h
    // Opaque white — scanned PDFs often render transparent → black/garbage for OCR
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    const task = page.render({
      canvasContext: ctx,
      viewport,
      background: 'rgb(255,255,255)',
      intent: 'print',
    })
    const onAbortRender = () => {
      try {
        task.cancel()
      } catch {
        /* */
      }
    }
    signal?.addEventListener('abort', onAbortRender)
    try {
      await task.promise
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw err
    } finally {
      signal?.removeEventListener('abort', onAbortRender)
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // Prefer PNG blob — more reliable than transferring a live canvas into the worker
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    // Release pixel buffer early on long OCR runs
    canvas.width = 0
    canvas.height = 0
    if (!blob || blob.size < 200) return ''
    try {
      return await recognizeImage(blob, signal)
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw err
    }
  }

  private async renderPage(pageNum: number) {
    if (!this.pdf || !this.pagesEl) return
    let wrap = this.pagesEl.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null
    if (!wrap) {
      this.ensureSlots()
      wrap = this.pagesEl.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null
    }
    if (!wrap) return
    if (wrap.dataset.filled === '1') return

    const page = await this.pdf.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    const { fitScale, dpr } = this.getRenderMetrics(base.width, base.height)
    const viewport = page.getViewport({ scale: fitScale })

    wrap.innerHTML = ''
    wrap.dataset.filled = '1'

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const outputScale = dpr
    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    if (outputScale !== 1) {
      ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0)
    }

    wrap.appendChild(canvas)
    const textLayer = document.createElement('div')
    textLayer.className = 'pdf-text-layer'
    wrap.appendChild(textLayer)

    await page.render({ canvasContext: ctx, viewport }).promise

    const measured = Math.max(wrap.offsetHeight, Math.floor(viewport.height))
    this.pageHeights.set(pageNum, measured)
    if (pageNum === 1) this.defaultPageHeight = measured
    wrap.style.minHeight = `${measured}px`
    wrap.style.height = ''

    const gen = this.textLayerGen
    scheduleIdle(() => {
      if (gen !== this.textLayerGen || !wrap?.isConnected) return
      void this.fillTextLayer(page, viewport, textLayer, pageNum, gen)
    })
  }

  private async fillTextLayer(
    page: PDFPageProxy,
    viewport: { width: number; height: number; convertToViewportPoint: (x: number, y: number) => number[] },
    layer: HTMLElement,
    pageNum: number,
    gen: number,
  ) {
    try {
      const tc = await page.getTextContent()
      if (gen !== this.textLayerGen || !layer.isConnected) return
      const parts: string[] = []
      layer.innerHTML = ''
      const baseW = page.getViewport({ scale: 1 }).width
      const scale = viewport.width / baseW
      for (const item of tc.items) {
        if (!('str' in item) || !item.str) continue
        parts.push(item.str)
        const tx = item.transform
        if (!tx || tx.length < 6) continue
        const [x, y] = viewport.convertToViewportPoint(tx[4], tx[5])
        const span = document.createElement('span')
        span.textContent = item.str
        const fh = Math.max(6, Math.hypot(tx[2], tx[3]) * scale)
        span.style.left = `${x}px`
        span.style.top = `${y - fh}px`
        span.style.fontSize = `${fh}px`
        layer.appendChild(span)
      }
      if (!this.ocrPages.has(pageNum)) {
        this.textCache.set(pageNum, parts.join(''))
      }
      const q = this.searchHl.get()
      if (q) this.searchHl.applyRoot(layer, false)
      // Re-paint highlights after text layer is ready (virtualized pages)
      if (this.annots.length) this.applyAnnotations(this.annots)
    } catch {
      /* text layer is best-effort */
    }
  }

  /**
   * B: unload canvas outside the live window but keep the slot + minHeight
   * so scrollTop / document height do not jump.
   */
  private evictOutside(start: number, end: number) {
    if (!this.virtualize || !this.pagesEl) return
    const nodes = [...this.pagesEl.querySelectorAll('.pdf-page')] as HTMLElement[]
    for (const el of nodes) {
      const n = Number(el.dataset.page)
      if (n >= start && n <= end) continue
      if (el.dataset.filled !== '1') continue
      const h = el.offsetHeight || this.slotHeight(n)
      this.pageHeights.set(n, h)
      el.innerHTML = ''
      el.dataset.filled = '0'
      el.style.minHeight = `${h}px`
    }
  }

  private async renderVisible(force = false) {
    if (!this.pdf || !this.pagesEl || this.rendering) return
    this.rendering = true
    const scroller = this.pagesEl
    const prevTop = scroller.scrollTop
    try {
      const probe = await this.pdf.getPage(this.page)
      const base = probe.getViewport({ scale: 1 })
      const { fitScale, dpr } = this.getRenderMetrics(base.width, base.height)
      const key = this.renderKey(fitScale, dpr)
      if (force || key !== this.lastRenderKey) {
        this.lastRenderKey = key
        this.textLayerGen += 1
        this.pageHeights.clear()
        // Estimate slot height from page-1 viewport before painting
        this.defaultPageHeight = Math.max(200, Math.floor(base.height * fitScale))
        this.ensureSlots()
      } else {
        this.ensureSlots()
      }

      const { start, end } = this.prefetchRange()
      await this.renderPage(this.page)
      for (let p = start; p <= end; p++) {
        if (p === this.page) continue
        await this.renderPage(p)
      }
      this.evictOutside(start, end)

      // Restore scroll after slot rebuild / height changes
      if (force) scroller.scrollTop = prevTop
    } finally {
      this.rendering = false
    }
  }

  private async waitForRenderIdle() {
    let spins = 0
    while (this.rendering && spins < 120) {
      await yieldToMain()
      spins++
    }
  }

  /** Scroll so that pageNum is at the top of the scroller (optional yRatio within page). */
  private scrollToPage(pageNum: number, yRatio = 0) {
    const scroller = this.pagesEl
    if (!scroller) return
    const target = scroller.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null
    if (target) {
      const sRect = scroller.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const delta = tRect.top - sRect.top + scroller.scrollTop
      const h = Math.max(1, target.offsetHeight)
      scroller.scrollTop = delta + h * Math.min(1, Math.max(0, yRatio))
      return
    }
    // Fallback: sum estimated slot heights (+ flex gap)
    const gap = 12
    let top = scroller.clientTop || 0
    for (let i = 1; i < pageNum; i++) top += this.slotHeight(i) + gap
    scroller.scrollTop = top + this.slotHeight(pageNum) * Math.min(1, Math.max(0, yRatio))
  }

  private onScroll = () => {
    if (!this.pagesEl) return
    const mid = this.pagesEl.scrollTop + this.pagesEl.clientHeight / 3
    const pages = [...this.pagesEl.querySelectorAll('.pdf-page')] as HTMLElement[]
    for (const el of pages) {
      if (el.offsetTop <= mid && el.offsetTop + el.offsetHeight > mid) {
        this.page = Number(el.dataset.page)
        break
      }
    }
    if (this.scrollTimer) window.clearTimeout(this.scrollTimer)
    this.scrollTimer = window.setTimeout(() => {
      void this.renderVisible()
      this.emitProgress()
    }, 150)
  }

  private onWheelEvent = (e: WheelEvent) => {
    const el = this.pagesEl
    if (!el) return
    if (this.pageTurn === 'scroll') {
      // 连续纵滑：不拦截，浏览器原生滚动
      return
    }
    // 横滑 / 仿真：滚轮 = 整页
    e.preventDefault()
    e.stopPropagation()
    this.wheelCb?.(e.deltaY)
  }

  private emitProgress() {
    this.progressCb?.(this.getProgress())
  }
}

function clampPdfZoom(z: number) {
  return Math.min(2.5, Math.max(0.6, z || 1))
}

function maxDprForQuality(quality: 'smooth' | 'hd'): number {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024
  if (quality === 'hd') {
    return w < 768 ? 2 : 3
  }
  if (w < 768) return 1.5
  if (w < 1100) return 2
  return 2.5
}

function yieldToMain() {
  return new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r())
    else setTimeout(r, 0)
  })
}

function scheduleIdle(fn: () => void) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 800 })
  } else {
    setTimeout(fn, 40)
  }
}

type PdfOutlineNode = {
  title?: string
  dest?: string | unknown[] | null
  items?: PdfOutlineNode[]
}

async function mapPdfOutline(
  pdf: PDFDocumentProxy,
  nodes: PdfOutlineNode[],
  prefix = '',
): Promise<TocItem[]> {
  const out: TocItem[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const page = await resolveOutlinePage(pdf, node.dest)
    const id = `pdf-toc-${prefix}${i}`
    const children =
      node.items?.length ? await mapPdfOutline(pdf, node.items, `${prefix}${i}-`) : undefined
    out.push({
      id,
      label: node.title?.trim() || `大纲 ${i + 1}`,
      locator: { type: 'pdf', page: page || i + 1, yRatio: 0 },
      children,
    })
  }
  return out
}

async function resolveOutlinePage(
  pdf: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined,
): Promise<number | null> {
  if (!dest) return null
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!explicit || !Array.isArray(explicit) || explicit[0] == null) return null
    const first = explicit[0]
    // Some outlines store a 0-based page index as a number
    if (typeof first === 'number' && Number.isFinite(first)) {
      return Math.min(pdf.numPages, Math.max(1, Math.floor(first) + 1))
    }
    const index = await pdf.getPageIndex(first as Parameters<PDFDocumentProxy['getPageIndex']>[0])
    return index + 1
  } catch {
    return null
  }
}
