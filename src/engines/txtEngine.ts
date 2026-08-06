import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { decodeTextBlob, splitTxtChapters, type TxtChapter } from '@/utils/encoding'
import { applyThemeVars, effectiveTheme } from '@/utils/format'
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

export class TxtEngine implements ReaderEngine {
  readonly capabilities = FULL_ENGINE_CAPABILITIES
  private text = ''
  private chapters: TxtChapter[] = []
  private chapterId = 0
  private container: HTMLElement | null = null
  private contentEl: HTMLElement | null = null
  private settings: ReaderSettings | null = null
  private progressCb: ((p: { locator: Locator; percent: number }) => void) | null = null
  private wheelCb: ((deltaY: number) => void) | null = null
  private scrollTimer: number | null = null
  private autoRaf = 0
  private pageTurn: PageTurnMode = 'slide'
  private selectionCb: ((e: SelectionCaptureEvent | null) => void) | null = null
  private readonly curl = createCurlGate()
  private readonly searchHl = createSearchHighlightState()
  private selectionBridge = createHostSelectionBridge({
    getRoot: () => this.contentEl,
    capture: () => this.captureSelection(),
    onEmit: (ev) => this.selectionCb?.(ev),
  })

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
    this.settings = settings
    this.pageTurn = settings.pageTurn
    if (!this.container) return
    applyThemeVars(this.container, effectiveTheme(settings), settings)
    if (this.contentEl) {
      this.contentEl.style.columnCount = settings.dualColumn && window.innerWidth >= 1100 ? '2' : '1'
      this.contentEl.style.columnGap = '2.5rem'
      // scroll: free scrolling; slide/curl: still scrollable but paging snaps by viewport
      this.contentEl.dataset.turn = settings.pageTurn
      this.contentEl.style.scrollBehavior = settings.pageTurn === 'scroll' ? 'smooth' : 'auto'
    }
    if (settings.autoScrollSpeed > 0) this.startAutoScroll(settings.autoScrollSpeed)
    else this.stopAutoScroll()
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
    return {
      locator: {
        type: 'txt' as const,
        chapterId: ch.id,
        offset: offsetRatio,
        charOffset,
      },
      percent,
    }
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
    if (!atBottom) {
      await this.curl.run(this.pageTurn, this.container, 'next', () => {
        const step = this.pageTurn === 'scroll' ? el.clientHeight * 0.7 : el.clientHeight * 0.92
        el.scrollBy({
          top: step,
          behavior: this.pageTurn === 'slide' ? 'auto' : this.pageTurn === 'curl' ? 'auto' : 'smooth',
        })
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
    if (el.scrollTop > 8) {
      await this.curl.run(this.pageTurn, this.container, 'prev', () => {
        const step = this.pageTurn === 'scroll' ? el.clientHeight * 0.7 : el.clientHeight * 0.92
        el.scrollBy({
          top: -step,
          behavior: this.pageTurn === 'slide' ? 'auto' : this.pageTurn === 'curl' ? 'auto' : 'smooth',
        })
        this.emitProgress()
      })
      return
    }
    if (this.chapterId > 0) {
      await this.curl.run(this.pageTurn, this.container, 'prev', async () => {
        this.chapterId--
        this.renderChapter()
        await new Promise((r) => requestAnimationFrame(r))
        el.scrollTop = el.scrollHeight
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

  onProgress(cb: (p: { locator: Locator; percent: number }) => void) {
    this.progressCb = cb
  }

  onWheel(cb: (deltaY: number) => void) {
    this.wheelCb = cb
  }

  onContentTap(_cb: (e: ContentTapEvent) => void) {
    // TXT uses host stage click zones; EPUB iframes need engine tap forwarding.
  }

  onSelection(cb: (e: SelectionCaptureEvent | null) => void) {
    this.selectionCb = cb
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
    // In paginated-style reading, let the shell turn pages at edges;
    // otherwise allow native scroll and also notify shell for page-flip-at-edge.
    const el = this.contentEl
    if (!el) return
    if (this.settings?.pageTurn === 'scroll') {
      this.wheelCb?.(e.deltaY)
      return
    }
    const atTop = el.scrollTop <= 0
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    if ((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
      e.preventDefault()
      e.stopPropagation()
      this.wheelCb?.(e.deltaY)
    }
  }

  private emitProgress() {
    this.progressCb?.(this.getProgress())
  }

  private startAutoScroll(speed: number) {
    this.stopAutoScroll()
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
