import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { decodeTextBlob, splitTxtChapters, type TxtChapter } from '@/utils/encoding'
import { applyThemeVars, effectiveTheme, DUAL_COLUMN_MIN_WIDTH } from '@/utils/format'
import { indexOfIgnoreCase } from '@/utils/searchText'
import {
  FULL_ENGINE_CAPABILITIES,
  type ContentTapEvent,
  type ReaderEngine,
  type SelectionCaptureEvent,
} from './types'
import { createCurlGate, createHostSelectionBridge, createSearchHighlightState } from './shared'
import { suppressHostCaret } from '@/utils/suppressCaret'
import { selectionRectFromSel } from '@/utils/selectionToolbar'
import { createMarkDragController, type MarkDragController, type MarkHandleRects } from '@/utils/markSelect'

export class TxtEngine implements ReaderEngine {
  readonly capabilities = FULL_ENGINE_CAPABILITIES
  private text = ''
  private chapters: TxtChapter[] = []
  private chapterId = 0
  private container: HTMLElement | null = null
  private contentEl: HTMLElement | null = null
  private settings: ReaderSettings | null = null
  private progressCb: ((p: import('@/engines/types').ReadingProgress) => void) | null = null
  private wheelCb: ((deltaY: number) => void) | null = null
  private scrollTimer: number | null = null
  private autoRaf = 0
  private pageTurn: PageTurnMode = 'slide'
  private selectMode = false
  private selectionCb: ((e: SelectionCaptureEvent | null) => void) | null = null
  private readonly curl = createCurlGate()
  private readonly searchHl = createSearchHighlightState()
  private autoScrollPaused = false
  private selectionBridge = createHostSelectionBridge({
    getRoot: () => this.contentEl,
    capture: () => this.captureSelection(),
    onEmit: (ev) => this.selectionCb?.(ev),
  })
  private markDragCtl: MarkDragController | null = null

  private getMarkDrag(): MarkDragController {
    if (!this.markDragCtl) {
      this.markDragCtl = createMarkDragController({
        getDocs: () => [document],
        getRoot: () => this.contentEl,
      })
    }
    return this.markDragCtl
  }

  async open(blob: Blob, settings: ReaderSettings, container: HTMLElement) {
    this.destroy()
    this.container = container
    this.settings = settings
    this.pageTurn = settings.pageTurn
    const { text } = await decodeTextBlob(blob)
    this.text = text
    this.chapters = splitTxtChapters(text)
    this.chapterId = 0

    container.innerHTML = ''
    container.className = 'txt-reader'
    const content = document.createElement('div')
    content.className = 'txt-content'
    container.appendChild(content)
    this.contentEl = content
    this.applySettings(settings)
    this.renderChapter()
    content.addEventListener('scroll', this.onScroll, { passive: true })
    content.addEventListener('wheel', this.onWheelEvent, { passive: false })
    this.selectionBridge.bind(content)
    suppressHostCaret(content)
  }

  destroy() {
    this.stopAutoScroll()
    this.selectionBridge.destroy()
    if (this.contentEl) {
      this.contentEl.removeEventListener('scroll', this.onScroll)
      this.contentEl.removeEventListener('wheel', this.onWheelEvent)
    }
    this.selectionCb = null
    if (this.container) this.container.innerHTML = ''
    this.container = null
    this.contentEl = null
  }

  applySettings(settings: ReaderSettings) {
    const prev = this.settings
    this.settings = { ...settings }
    this.pageTurn = settings.pageTurn
    if (!this.container) return
    applyThemeVars(this.container, effectiveTheme(settings), settings)
    if (this.contentEl) {
      applyThemeVars(this.contentEl, effectiveTheme(settings), settings)
      const dual =
        settings.dualColumn &&
        settings.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
      const prevDual =
        !!prev &&
        prev.dualColumn &&
        prev.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
      this.contentEl.style.columnCount = dual ? '2' : '1'
      this.contentEl.style.columnGap = dual ? '3.75rem' : '2.5rem'
      this.contentEl.dataset.turn = settings.pageTurn
      if (dual) this.contentEl.dataset.dual = '1'
      else delete this.contentEl.dataset.dual
      if (this.container) {
        if (dual) this.container.dataset.dual = '1'
        else delete this.container.dataset.dual
      }
      if (settings.pageTurn === 'scroll') {
        this.contentEl.style.overflowY = 'auto'
        this.contentEl.style.scrollBehavior = 'smooth'
      } else {
        // 横滑 / 仿真：按屏分页，禁止自由纵滑
        this.contentEl.style.overflowY = 'hidden'
        this.contentEl.style.scrollBehavior = 'auto'
        requestAnimationFrame(() => {
          // Dual toggle must reflow columns before snap
          if (dual !== prevDual) void this.contentEl?.offsetHeight
          this.snapToNearestPage()
        })
      }
    }
    // 自动滚屏仅上下滑动模式
    if (settings.pageTurn === 'scroll' && settings.autoScrollSpeed > 0) {
      if (!prev || prev.autoScrollSpeed <= 0) this.autoScrollPaused = false
      if (!this.autoScrollPaused) this.startAutoScroll(settings.autoScrollSpeed)
      else this.stopAutoScroll()
    } else {
      this.stopAutoScroll()
    }
  }

  /** @returns paused | running | null if auto-scroll not active */
  toggleAutoScrollPause(): 'paused' | 'running' | null {
    if (!this.settings || this.settings.pageTurn !== 'scroll' || this.settings.autoScrollSpeed <= 0) {
      return null
    }
    this.autoScrollPaused = !this.autoScrollPaused
    if (this.autoScrollPaused) this.stopAutoScroll()
    else this.startAutoScroll(this.settings.autoScrollSpeed)
    return this.autoScrollPaused ? 'paused' : 'running'
  }

  isAutoScrollPaused() {
    return this.autoScrollPaused
  }

  /** Viewport page height for 横滑 / 仿真 (one screen = one page). */
  private pageHeight(el: HTMLElement) {
    return Math.max(1, el.clientHeight)
  }

  private maxScroll(el: HTMLElement) {
    return Math.max(0, el.scrollHeight - this.pageHeight(el))
  }

  private maxPageIndex(el: HTMLElement) {
    const max = this.maxScroll(el)
    if (max <= 0) return 0
    return Math.ceil(max / this.pageHeight(el))
  }

  private pageIndex(el: HTMLElement) {
    const max = this.maxScroll(el)
    if (max <= 0) return 0
    if (el.scrollTop >= max - 2) return this.maxPageIndex(el)
    return Math.min(this.maxPageIndex(el), Math.round(el.scrollTop / this.pageHeight(el)))
  }

  private jumpToPageIndex(el: HTMLElement, index: number) {
    const i = Math.min(this.maxPageIndex(el), Math.max(0, index))
    el.scrollTop = Math.min(this.maxScroll(el), i * this.pageHeight(el))
  }

  private snapToNearestPage() {
    const el = this.contentEl
    if (!el || this.pageTurn === 'scroll') return
    this.jumpToPageIndex(el, this.pageIndex(el))
  }

  getToc(): TocItem[] {
    return this.chapters.map((c) => ({
      id: String(c.id),
      label: c.title,
      locator: { type: 'txt', chapterId: c.id, offset: 0, charOffset: c.start } as Locator,
    }))
  }

  getProgress() {
    const ch = this.chapters[this.chapterId] || this.chapters[0]
    const el = this.contentEl
    const offsetRatio = el && el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0
    const charOffset = Math.floor(ch.start + (ch.end - ch.start) * offsetRatio)
    const percent = this.text.length ? (charOffset / this.text.length) * 100 : 0
    const pages = this.estimateTxtPages(el, ch, charOffset)
    return {
      locator: {
        type: 'txt' as const,
        chapterId: ch.id,
        offset: offsetRatio,
        charOffset,
      },
      percent,
      ...pages,
    }
  }

  /** Book-level page estimate from current chapter's page metrics (or char density). */
  private estimateTxtPages(
    el: HTMLElement | null,
    ch: { start: number; end: number },
    charOffset: number,
  ): { page: number; pageCount: number; pageMode: 'estimate' } {
    const textLen = Math.max(1, this.text.length)
    const chLen = Math.max(1, ch.end - ch.start)
    if (el && this.pageTurn !== 'scroll') {
      const totalInCh = this.maxPageIndex(el) + 1
      const curInCh = this.pageIndex(el) + 1
      const charsPerPage = chLen / Math.max(1, totalInCh)
      const pageCount = Math.max(1, Math.round(textLen / Math.max(1, charsPerPage)))
      const before = Math.round(ch.start / Math.max(1, charsPerPage))
      const page = Math.min(pageCount, Math.max(1, before + curInCh))
      return { page, pageCount, pageMode: 'estimate' }
    }
    // Scroll / no layout yet: ~800 chars per "screen" as a stable estimate.
    const charsPerPage = el && el.clientHeight > 0
      ? Math.max(200, Math.round(chLen / Math.max(1, Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)))))
      : 800
    const pageCount = Math.max(1, Math.round(textLen / charsPerPage))
    const page = Math.min(pageCount, Math.max(1, Math.round(charOffset / charsPerPage) + 1))
    return { page, pageCount, pageMode: 'estimate' }
  }

  async goTo(locator: Locator) {
    if (locator.type !== 'txt') return
    this.chapterId = Math.max(0, Math.min(this.chapters.length - 1, locator.chapterId))
    this.renderChapter()
    await new Promise((r) => requestAnimationFrame(r))
    if (this.contentEl) {
      const max = this.contentEl.scrollHeight - this.contentEl.clientHeight
      this.contentEl.scrollTop = max * (locator.offset || 0)
    }
    if (this.searchHl.get()) {
      this.searchHl.applyRoot(this.contentEl, true)
    }
  }

  highlightSearch(query: string | null) {
    this.searchHl.set(query)
    this.searchHl.applyRoot(this.contentEl, true)
  }

  async goToPercent(percent: number) {
    const p = Math.min(100, Math.max(0, percent)) / 100
    const charOffset = Math.floor(this.text.length * p)
    const ch = this.chapters.find((c) => charOffset >= c.start && charOffset < c.end) || this.chapters[0]
    if (!ch) return
    await this.goTo({
      type: 'txt',
      chapterId: ch.id,
      offset: (charOffset - ch.start) / Math.max(1, ch.end - ch.start),
      charOffset,
    })
  }

  async next() {
    const el = this.contentEl
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    if (this.pageTurn === 'scroll') {
      if (!atBottom) {
        el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
        this.emitProgress()
        return
      }
      if (this.chapterId < this.chapters.length - 1) {
        this.chapterId++
        this.renderChapter()
        this.emitProgress()
      }
      return
    }
    // 横滑 / 仿真：按视口整屏分页
    const cur = this.pageIndex(el)
    if (cur < this.maxPageIndex(el)) {
      await this.curl.run(this.pageTurn, this.container, 'next', () => {
        this.jumpToPageIndex(el, cur + 1)
        this.emitProgress()
      })
      return
    }
    if (this.chapterId < this.chapters.length - 1) {
      await this.curl.run(this.pageTurn, this.container, 'next', () => {
        this.chapterId++
        this.renderChapter()
        this.emitProgress()
      })
    }
  }

  async prev() {
    const el = this.contentEl
    if (!el) return
    if (this.pageTurn === 'scroll') {
      if (el.scrollTop > 8) {
        el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' })
        this.emitProgress()
        return
      }
      if (this.chapterId > 0) {
        this.chapterId--
        this.renderChapter()
        await new Promise((r) => requestAnimationFrame(r))
        el.scrollTop = el.scrollHeight
        this.emitProgress()
      }
      return
    }
    const cur = this.pageIndex(el)
    if (cur > 0 || el.scrollTop > 4) {
      await this.curl.run(this.pageTurn, this.container, 'prev', () => {
        this.jumpToPageIndex(el, Math.max(0, cur - 1))
        this.emitProgress()
      })
      return
    }
    if (this.chapterId > 0) {
      await this.curl.run(this.pageTurn, this.container, 'prev', async () => {
        this.chapterId--
        this.renderChapter()
        await new Promise((r) => requestAnimationFrame(r))
        this.jumpToPageIndex(el, this.maxPageIndex(el))
        this.emitProgress()
      })
    }
  }

  async search(query: string): Promise<SearchHit[]> {
    if (!query.trim()) return []
    const q = query.trim()
    const hits: SearchHit[] = []
    let idx = 0
    while (idx < this.text.length && hits.length < 50) {
      const found = indexOfIgnoreCase(this.text, q, idx)
      if (found < 0) break
      const ch = this.chapters.find((c) => found >= c.start && found < c.end) || this.chapters[0]
      const snippet = this.text.slice(Math.max(0, found - 20), found + q.length + 20)
      hits.push({
        snippet: `…${snippet}…`,
        locator: {
          type: 'txt',
          chapterId: ch.id,
          offset: (found - ch.start) / Math.max(1, ch.end - ch.start),
          charOffset: found,
        },
      })
      idx = found + Math.max(1, q.length)
    }
    return hits
  }

  onProgress(cb: (p: import('@/engines/types').ReadingProgress) => void) {
    this.progressCb = cb
  }

  onWheel(cb: (deltaY: number) => void) {
    this.wheelCb = cb
  }

  onContentTap(_cb: (e: ContentTapEvent) => void) {
    // TXT uses host stage click zones; EPUB iframes need engine tap forwarding.
  }

  onContentGesture(_cb: (e: import('./types').ContentGestureEvent) => void) {
    // TXT: stage pointer handlers cover swipe.
  }

  onSelection(cb: (e: SelectionCaptureEvent | null) => void) {
    this.selectionCb = cb
  }

  setSelectMode(active: boolean) {
    this.selectMode = active
    const el = this.contentEl
    if (!el) return
    el.classList.toggle('select-mode', active)
    el.style.touchAction = active ? 'auto' : ''
  }

  clearNativeSelection() {
    this.markDragCtl?.endDrag()
    this.markDragCtl?.endHandle()
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      /* */
    }
  }

  markDrag(phase: 'start' | 'move' | 'end', clientX: number, clientY: number): MarkHandleRects | null {
    const ctl = this.getMarkDrag()
    if (phase === 'start') {
      ctl.beginDrag(clientX, clientY)
      return ctl.getHandleRects()
    }
    if (phase === 'move') {
      ctl.moveDrag(clientX, clientY)
      return ctl.getHandleRects()
    }
    ctl.endDrag()
    return ctl.getHandleRects()
  }

  markHandle(
    phase: 'start' | 'move' | 'end',
    which: 'start' | 'end',
    clientX: number,
    clientY: number,
  ): MarkHandleRects | null {
    const ctl = this.getMarkDrag()
    if (phase === 'start') {
      ctl.beginHandle(which)
      return ctl.getHandleRects()
    }
    if (phase === 'move') {
      ctl.moveHandle(clientX, clientY)
      return ctl.getHandleRects()
    }
    ctl.endHandle()
    return ctl.getHandleRects()
  }

  getMarkHandleRects(): MarkHandleRects | null {
    return this.getMarkDrag().getHandleRects()
  }

  applyAnnotations(annots: AnnotationRecord[]) {
    if (!this.contentEl) return
    this.contentEl.querySelectorAll('mark.annot').forEach((n) => {
      const parent = n.parentNode
      if (!parent) return
      parent.replaceChild(document.createTextNode(n.textContent || ''), n)
      parent.normalize()
    })
    const ch = this.chapters[this.chapterId]
    if (!ch) return
    const chapterAnnots = annots.filter(
      (a) => a.type === 'highlight' && a.locator.type === 'txt' && a.locator.chapterId === ch.id && a.selectedText,
    )
    for (const a of chapterAnnots) {
      this.highlightText(a.selectedText!, a.color)
    }
  }

  getSelectableText() {
    const ch = this.chapters[this.chapterId]
    if (!ch) return this.text
    return this.text.slice(ch.start, ch.end)
  }

  captureSelection() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null
    if (this.contentEl && sel.anchorNode && !this.contentEl.contains(sel.anchorNode)) return null
    const text = sel.toString().trim()
    const ch = this.chapters[this.chapterId]
    const local = this.text.slice(ch.start, ch.end).indexOf(text)
    const charOffset = local >= 0 ? ch.start + local : ch.start
    return {
      text,
      locator: {
        type: 'txt' as const,
        chapterId: ch.id,
        offset: (charOffset - ch.start) / Math.max(1, ch.end - ch.start),
        charOffset,
      },
      rect: selectionRectFromSel(sel) ?? undefined,
    }
  }

  private highlightText(needle: string, color: string) {
    if (!this.contentEl || !needle) return
    const walker = document.createTreeWalker(this.contentEl, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || ''
      const i = value.indexOf(needle)
      if (i < 0) continue
      try {
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + needle.length)
        const mark = document.createElement('mark')
        mark.className = 'annot'
        mark.style.background = color
        // extractContents + insert is safer than surroundContents across edges
        const frag = range.extractContents()
        mark.appendChild(frag)
        range.insertNode(mark)
      } catch (err) {
        console.warn('txt highlight failed', err)
      }
      break
    }
  }

  private renderChapter() {
    if (!this.contentEl) return
    const ch = this.chapters[this.chapterId]
    const body = this.text.slice(ch.start, ch.end)
    const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean)

    // Pull chapter heading out of body so it is not text-indented like prose
    let rest = paras
    const title = ch.title.trim()
    const showTitle = Boolean(title) && title !== '全文'
    if (showTitle && rest.length) {
      const first = rest[0]
      if (first === title || first.includes(title) || title.includes(first)) {
        rest = rest.slice(1)
      }
    }

    const titleHtml = showTitle ? `<h2 class="chapter-title">${escapeHtml(title)}</h2>` : ''
    const bodyHtml = rest.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
    this.contentEl.innerHTML = titleHtml + bodyHtml
    this.contentEl.scrollTop = 0
    this.emitProgress()
    if (this.searchHl.get()) {
      this.searchHl.applyRoot(this.contentEl, false)
    }
  }

  private onScroll = () => {
    if (this.scrollTimer) window.clearTimeout(this.scrollTimer)
    this.scrollTimer = window.setTimeout(() => this.emitProgress(), 200)
  }

  private onWheelEvent = (e: WheelEvent) => {
    const el = this.contentEl
    if (!el) return
    if (this.pageTurn === 'scroll') {
      // 上下滑动：原生连续滚动
      return
    }
    // 横滑 / 仿真：滚轮整屏翻页
    e.preventDefault()
    e.stopPropagation()
    this.wheelCb?.(e.deltaY)
  }

  private emitProgress() {
    this.progressCb?.(this.getProgress())
  }

  private startAutoScroll(speed: number) {
    this.stopAutoScroll()
    if (this.autoScrollPaused || speed <= 0) return
    const step = () => {
      if (this.contentEl) this.contentEl.scrollTop += speed * 0.4
      this.autoRaf = requestAnimationFrame(step)
    }
    this.autoRaf = requestAnimationFrame(step)
  }

  private stopAutoScroll() {
    if (this.autoRaf) cancelAnimationFrame(this.autoRaf)
    this.autoRaf = 0
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
