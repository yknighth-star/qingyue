import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { applyThemeVars, effectiveTheme } from '@/utils/format'
import type { ReaderEngine, SelectionCaptureEvent } from './types'
import { suppressHostCaret } from '@/utils/suppressCaret'
import { playCurlIn, playCurlOut } from '@/utils/pageCurl'
import { buildSelectionEvent, selectionRectFromSel } from '@/utils/selectionToolbar'
import { clearSearchMarks, highlightSearchInRoot } from '@/utils/domHighlight'
import { indexOfIgnoreCase } from '@/utils/searchText'

/**
 * Same-origin worker (copied to dist/public by vite plugin).
 * Avoids CDN latency on mobile networks.
 */
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`

export class PdfEngine implements ReaderEngine {
  private pdf: PDFDocumentProxy | null = null
  private container: HTMLElement | null = null
  private pagesEl: HTMLElement | null = null
  private page = 1
  private settings: ReaderSettings | null = null
  private progressCb: ((p: { locator: Locator; percent: number }) => void) | null = null
  private wheelCb: ((deltaY: number) => void) | null = null
  /** User zoom multiplier from settings (1 = fit container width) */
  private userZoom = 1
  private pdfQuality: 'smooth' | 'hd' = 'smooth'
  private rendering = false
  private toc: TocItem[] = []
  private scrollTimer: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private resizeTimer: number | null = null
  private lastRenderKey = ''
  private pageTurn: PageTurnMode = 'slide'
  private curling = false
  private selectionCb: ((e: SelectionCaptureEvent | null) => void) | null = null
  private selectionDebounce: number | null = null
  private selectingPointer = false
  private activeSearchQuery: string | null = null

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
    this.bindSelectionEvents(pages)
    suppressHostCaret(pages)
    this.observeResize(pages)

    // First page ASAP — neighbors + outline load after open returns
    await this.renderPage(this.page)
    this.emitProgress()
    void this.loadOutline()
    void this.renderNeighbors()
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

  private bindSelectionEvents(el: HTMLElement) {
    el.addEventListener('mousedown', () => {
      this.selectingPointer = true
    })
    el.addEventListener('mouseup', (e) => {
      this.selectingPointer = false
      this.scheduleEmitSelection(e.clientX, e.clientY)
    })
    document.addEventListener('selectionchange', this.onDocSelectionChange)
  }

  private onDocSelectionChange = () => {
    if (!this.pagesEl || this.selectingPointer) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    if (!this.pagesEl.contains(sel.anchorNode)) return
    this.scheduleEmitSelection()
  }

  private scheduleEmitSelection(fallbackX?: number, fallbackY?: number) {
    if (this.selectionDebounce) window.clearTimeout(this.selectionDebounce)
    this.selectionDebounce = window.setTimeout(() => {
      this.selectionDebounce = null
      const cap = this.captureSelection()
      if (!cap?.text) return
      const ev = buildSelectionEvent(cap.text, cap.locator, cap.rect ?? null, fallbackX, fallbackY)
      if (ev) this.selectionCb?.(ev)
    }, 50)
  }

  destroy() {
    if (this.selectionDebounce) window.clearTimeout(this.selectionDebounce)
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    document.removeEventListener('selectionchange', this.onDocSelectionChange)
    if (this.pagesEl) {
      this.pagesEl.removeEventListener('scroll', this.onScroll)
      this.pagesEl.removeEventListener('wheel', this.onWheelEvent)
    }
    this.selectionCb = null
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
    this.settings = settings
    this.pageTurn = settings.pageTurn
    this.userZoom = clampPdfZoom(settings.pdfZoom ?? 1)
    this.pdfQuality = settings.pdfQuality === 'hd' ? 'hd' : 'smooth'
    if (this.container) {
      applyThemeVars(this.container, effectiveTheme(settings), settings)
    }
    if (this.pagesEl) {
      this.pagesEl.dataset.turn = settings.pageTurn
      this.pagesEl.style.scrollBehavior = settings.pageTurn === 'slide' ? 'auto' : 'smooth'
    }
    if (Math.abs(prevZoom - this.userZoom) > 0.001 || prevQuality !== this.pdfQuality) {
      void this.renderVisible(true)
    }
  }

  getToc() {
    return this.toc.length
      ? this.toc
      : Array.from({ length: this.pdf?.numPages || 0 }, (_, i) => ({
          id: `p${i + 1}`,
          label: `�?${i + 1} 页`,
          locator: { type: 'pdf' as const, page: i + 1, yRatio: 0 },
        }))
  }

  getProgress() {
    const total = this.pdf?.numPages || 1
    const yRatio = this.pagesEl
      ? this.pagesEl.scrollTop / Math.max(1, this.pagesEl.scrollHeight - this.pagesEl.clientHeight)
      : 0
    return {
      locator: { type: 'pdf' as const, page: this.page, yRatio },
      percent: ((this.page - 1 + yRatio) / total) * 100,
    }
  }

  async goTo(locator: Locator) {
    if (locator.type !== 'pdf' || !this.pdf) return
    this.page = Math.min(this.pdf.numPages, Math.max(1, locator.page))
    await this.renderVisible(true)
    if (this.pagesEl) {
      const target = this.pagesEl.querySelector(`[data-page="${this.page}"]`) as HTMLElement | null
      if (target) {
        const top = target.offsetTop + target.offsetHeight * (locator.yRatio || 0)
        this.pagesEl.scrollTop = top
      }
    }
    if (this.activeSearchQuery) this.highlightSearch(this.activeSearchQuery)
  }

  highlightSearch(query: string | null) {
    this.activeSearchQuery = query?.trim() || null
    if (!this.pagesEl) return
    clearSearchMarks(this.pagesEl)
    if (!this.activeSearchQuery) return
    const layers = this.pagesEl.querySelectorAll('.pdf-text-layer, .pdf-page')
    for (const layer of layers) {
      if ((layer as HTMLElement).innerText?.trim()) {
        highlightSearchInRoot(layer as HTMLElement, this.activeSearchQuery, true)
      }
    }
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
    const turn = async () => {
      if (this.pageTurn === 'scroll' && this.pagesEl) {
        const el = this.pagesEl
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
        if (!atBottom) {
          el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
          this.emitProgress()
          return
        }
      }
      if (this.page < pdf.numPages) {
        this.page++
        await this.renderVisible(true)
        this.scrollToPage(this.page)
        this.emitProgress()
      }
    }
    if (this.pageTurn === 'curl') {
      if (this.curling) return
      this.curling = true
      try {
        await playCurlOut(this.container, 'next')
        await turn()
        await playCurlIn(this.container, 'next')
      } finally {
        this.curling = false
      }
      return
    }
    await turn()
  }

  async prev() {
    const turn = async () => {
      if (this.pageTurn === 'scroll' && this.pagesEl && this.pagesEl.scrollTop > 8) {
        this.pagesEl.scrollBy({ top: -this.pagesEl.clientHeight * 0.85, behavior: 'smooth' })
        this.emitProgress()
        return
      }
      if (this.page > 1) {
        this.page--
        await this.renderVisible(true)
        this.scrollToPage(this.page)
        this.emitProgress()
      }
    }
    if (this.pageTurn === 'curl') {
      if (this.curling) return
      this.curling = true
      try {
        await playCurlOut(this.container, 'prev')
        await turn()
        await playCurlIn(this.container, 'prev')
      } finally {
        this.curling = false
      }
      return
    }
    await turn()
  }

  async search(query: string): Promise<SearchHit[]> {
    if (!this.pdf || !query.trim()) return []
    const q = query.trim()
    const hits: SearchHit[] = []
    for (let p = 1; p <= this.pdf.numPages && hits.length < 40; p++) {
      const page = await this.pdf.getPage(p)
      const tc = await page.getTextContent()
      const text = tc.items.map((it) => ('str' in it ? it.str : '')).join('')
      let idx = 0
      while (hits.length < 40) {
        const found = indexOfIgnoreCase(text, q, idx)
        if (found < 0) break
        hits.push({
          snippet: `…${text.slice(Math.max(0, found - 16), found + q.length + 16)}…`,
          locator: { type: 'pdf', page: p, yRatio: 0 },
        })
        idx = found + Math.max(1, q.length)
      }
    }
    return hits
  }

  onProgress(cb: (p: { locator: Locator; percent: number }) => void) {
    this.progressCb = cb
  }

  onWheel(cb: (deltaY: number) => void) {
    this.wheelCb = cb
  }

  onSelection(cb: (e: SelectionCaptureEvent | null) => void) {
    this.selectionCb = cb
  }

  applyAnnotations(annots: AnnotationRecord[]) {
    if (!this.pagesEl) return
    this.pagesEl.querySelectorAll('.pdf-bookmark-flag').forEach((n) => n.remove())
    for (const a of annots) {
      if (a.locator.type !== 'pdf') continue
      const pageEl = this.pagesEl.querySelector(`[data-page="${a.locator.page}"]`)
      if (!pageEl) continue
      if (a.type === 'bookmark') {
        const flag = document.createElement('div')
        flag.className = 'pdf-bookmark-flag'
        flag.textContent = '书签'
        pageEl.appendChild(flag)
      }
    }
  }

  getSelectableText() {
    return window.getSelection()?.toString().trim() || ''
  }

  captureSelection() {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!text) return null
    if (this.pagesEl && sel?.anchorNode && !this.pagesEl.contains(sel.anchorNode)) return null
    return {
      text,
      locator: { type: 'pdf' as const, page: this.page, yRatio: 0 },
      rect: selectionRectFromSel(sel) ?? undefined,
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

  /** Fit page to container width; DPR capped by quality mode for mobile speed. */
  private getRenderMetrics(pageWidthAtScale1: number) {
    const padding = 24
    const containerWidth = Math.max(
      200,
      (this.pagesEl?.clientWidth || this.container?.clientWidth || 800) - padding,
    )
    const fitScale = (containerWidth / Math.max(1, pageWidthAtScale1)) * this.userZoom
    const native = Math.max(window.devicePixelRatio || 1, 1)
    const dpr = Math.min(native, maxDprForQuality(this.pdfQuality))
    return { fitScale: Math.max(0.4, fitScale), dpr }
  }

  private renderKey(fitScale: number, dpr: number) {
    return `${fitScale.toFixed(3)}_${dpr.toFixed(2)}_${this.userZoom}_${this.pdfQuality}`
  }

  private prefetchRange() {
    const total = this.pdf?.numPages || 1
    const pad = this.pdfQuality === 'hd' ? 2 : 1
    return {
      start: Math.max(1, this.page - pad),
      end: Math.min(total, this.page + pad),
    }
  }

  private async renderPage(pageNum: number) {
    if (!this.pdf || !this.pagesEl) return
    if (this.pagesEl.querySelector(`[data-page="${pageNum}"]`)) return

    const page = await this.pdf.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    const { fitScale, dpr } = this.getRenderMetrics(base.width)
    const key = this.renderKey(fitScale, dpr)
    if (key !== this.lastRenderKey) {
      this.pagesEl.innerHTML = ''
      this.lastRenderKey = key
    }

    const viewport = page.getViewport({ scale: fitScale })
    const wrap = document.createElement('div')
    wrap.className = 'pdf-page'
    wrap.dataset.page = String(pageNum)

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
    this.pagesEl.appendChild(wrap)
    await page.render({ canvasContext: ctx, viewport }).promise

    const nodes = [...this.pagesEl.children] as HTMLElement[]
    nodes.sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page))
    nodes.forEach((n) => this.pagesEl!.appendChild(n))
  }

  private async renderNeighbors() {
    const { start, end } = this.prefetchRange()
    for (let p = start; p <= end; p++) {
      if (p === this.page) continue
      await this.renderPage(p)
    }
  }

  private async renderVisible(force = false) {
    if (!this.pdf || !this.pagesEl || this.rendering) return
    this.rendering = true
    try {
      const probe = await this.pdf.getPage(this.page)
      const base = probe.getViewport({ scale: 1 })
      const { fitScale, dpr } = this.getRenderMetrics(base.width)
      const key = this.renderKey(fitScale, dpr)
      if (force || key !== this.lastRenderKey) {
        this.pagesEl.innerHTML = ''
        this.lastRenderKey = key
      }

      const { start, end } = this.prefetchRange()
      // Current page first for responsiveness
      await this.renderPage(this.page)
      for (let p = start; p <= end; p++) {
        if (p === this.page) continue
        await this.renderPage(p)
      }
    } finally {
      this.rendering = false
    }
  }

  private scrollToPage(page: number) {
    const el = this.pagesEl?.querySelector(`[data-page="${page}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'start' })
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
    if (this.settings?.pageTurn === 'scroll') {
      this.wheelCb?.(e.deltaY)
      return
    }
    const atTop = el.scrollTop <= 0
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    if ((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop) || el.scrollHeight <= el.clientHeight + 2) {
      e.preventDefault()
      e.stopPropagation()
      this.wheelCb?.(e.deltaY)
    }
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
  // smooth (default): favor speed on phones
  if (w < 768) return 1.5
  if (w < 1100) return 2
  return 2.5
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
    if (!explicit || !Array.isArray(explicit) || !explicit[0]) return null
    const index = await pdf.getPageIndex(explicit[0] as Parameters<PDFDocumentProxy['getPageIndex']>[0])
    return index + 1
  } catch {
    return null
  }
}
