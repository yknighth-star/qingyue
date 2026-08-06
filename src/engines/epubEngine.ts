import ePub, { type Book, type NavItem, type Rendition } from 'epubjs'
import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { applyThemeVars, effectiveTheme } from '@/utils/format'
import { buildSelectionEvent, mapPointToParentViewport, mapRectToParentViewport, selectionRectFromSel } from '@/utils/selectionToolbar'
import { clearSearchMarks, highlightSearchInRoot } from '@/utils/domHighlight'
import { indexOfIgnoreCase } from '@/utils/searchText'
import type { ContentTapEvent, ReaderEngine, SelectionCaptureEvent } from './types'
import { injectCaretSuppression } from '@/utils/suppressCaret'
import { playCurlIn, playCurlOut } from '@/utils/pageCurl'

type ContentsDoc = {
  document: Document
  window: Window
  addStylesheetRules?: (rules: unknown) => void
}

export class EpubEngine implements ReaderEngine {
  private book: Book | null = null
  private rendition: Rendition | null = null
  private container: HTMLElement | null = null
  private settings: ReaderSettings | null = null
  private toc: TocItem[] = []
  private spineLength = 1
  private spineIndex = 0
  private progressCb: ((p: { locator: Locator; percent: number }) => void) | null = null
  private wheelCb: ((deltaY: number) => void) | null = null
  private tapCb: ((e: ContentTapEvent) => void) | null = null
  private selectionCb: ((e: SelectionCaptureEvent | null) => void) | null = null
  private boundDocs = new WeakSet<Document>()
  private pageTurn: PageTurnMode = 'slide'
  private curling = false
  private selectionDebounce: number | null = null
  private appliedHighlightCfis: string[] = []
  private activeSearchQuery: string | null = null

  async open(blob: Blob, settings: ReaderSettings, container: HTMLElement) {
    this.destroy()
    this.container = container
    this.settings = settings
    this.pageTurn = settings.pageTurn
    container.innerHTML = ''
    container.className = 'epub-reader'
    applyThemeVars(container, effectiveTheme(settings), settings)

    // Blob URLs lack an .epub extension, so epubjs mis-detects type and never finishes
    // opening. Pass ArrayBuffer so it opens as binary EPUB reliably.
    const data = await blob.arrayBuffer()
    this.book = ePub(data)
    await this.book.opened
    await this.book.ready
    this.spineLength = (this.book.spine as { length?: number }).length || 1
    const nav = this.book.navigation
    this.toc = flattenNav(nav?.toc || [])

    this.rendition = this.book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: settings.pageTurn === 'scroll' ? 'scrolled-doc' : 'paginated',
      // epub.js default overflow "auto" enables BOTH axes; force scroll+vertical so x stays hidden
      overflow: settings.pageTurn === 'scroll' ? 'scroll' : 'hidden',
      spread: settings.dualColumn && window.innerWidth >= 1100 ? 'always' : 'none',
      // EPUB chapters often include scripts (TOC links, footnotes). Without this,
      // Chromium blocks them in about:srcdoc sandboxed iframes.
      allowScriptedContent: true,
    })
    this.applyThemeToRendition(settings)

    // Forward wheel/click from chapter iframes to the reader shell (PC UX).
    const hooks = this.rendition as unknown as {
      hooks: { content: { register: (fn: (contents: ContentsDoc) => void) => void } }
    }
    hooks.hooks.content.register((contents) => this.bindContentEvents(contents))

    await this.rendition.display()
    this.lockEpubHorizontalOverflow()

    this.rendition.on('relocated', (...args: unknown[]) => {
      const loc = args[0] as { start: { cfi: string; index: number }; percentage?: number }
      this.spineIndex = loc.start?.index ?? 0
      this.progressCb?.(this.getProgressFromLoc(loc))
      this.lockEpubHorizontalOverflow()
    })
  }

  /** Kill horizontal scrollbars that epub.js "overflow: auto" otherwise enables. */
  private lockEpubHorizontalOverflow() {
    const root = this.container
    if (!root) return
    const container = root.querySelector('.epub-container') as HTMLElement | null
    if (container) {
      container.style.setProperty('overflow-x', 'hidden', 'important')
      if (this.pageTurn === 'scroll') {
        container.style.setProperty('overflow-y', 'auto', 'important')
      }
      container.style.maxWidth = '100%'
      container.style.boxSizing = 'border-box'
    }
    root.querySelectorAll('.epub-view, .epub-view iframe').forEach((el) => {
      if (!(el instanceof HTMLElement)) return
      el.style.maxWidth = '100%'
      el.style.boxSizing = 'border-box'
      if (el.classList.contains('epub-view')) el.style.overflowX = 'hidden'
    })
  }

  private emitSelectionNow(fallbackX?: number, fallbackY?: number) {
    const cap = this.captureSelection()
    if (!cap?.text) return
    const ev = buildSelectionEvent(cap.text, cap.locator, cap.rect ?? null, fallbackX, fallbackY)
    if (ev) this.selectionCb?.(ev)
  }

  private scheduleEmitSelection(fallbackX?: number, fallbackY?: number) {
    if (this.selectionDebounce) window.clearTimeout(this.selectionDebounce)
    this.selectionDebounce = window.setTimeout(() => {
      this.selectionDebounce = null
      this.emitSelectionNow(fallbackX, fallbackY)
    }, 50)
  }

  private bindContentEvents(contents: ContentsDoc) {
    const doc = contents.document
    if (!doc || this.boundDocs.has(doc)) return
    this.boundDocs.add(doc)

    injectCaretSuppression(doc)

    this.normalizeChapterTitles(doc)
    this.containOverflowMedia(doc)

    // Re-apply search marks when chapter iframe mounts / remounts
    if (this.activeSearchQuery && doc.body) {
      this.ensureSearchHitStyle(doc)
      window.setTimeout(() => {
        if (this.activeSearchQuery && doc.body) {
          highlightSearchInRoot(doc.body, this.activeSearchQuery, true)
        }
      }, 30)
    }

    // Also tame the iframe element itself (host page mouse cursor over iframe).
    try {
      const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
      if (iframe) {
        iframe.style.cursor = 'default'
        iframe.tabIndex = -1
      }
    } catch {
      /* cross-origin unlikely for srcdoc */
    }

    doc.addEventListener(
      'wheel',
      (e) => {
        if (this.settings?.pageTurn === 'scroll') return
        e.preventDefault()
        this.wheelCb?.(e.deltaY)
      },
      { passive: false },
    )

    let pointerDown = false
    doc.addEventListener('mousedown', () => {
      pointerDown = true
    })
    doc.addEventListener('mouseup', (e) => {
      pointerDown = false
      const p = mapPointToParentViewport(e.clientX, e.clientY, doc)
      this.scheduleEmitSelection(p.x, p.y)
    })
    doc.addEventListener('selectionchange', () => {
      if (pointerDown) return
      const sel = doc.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return
      this.scheduleEmitSelection()
    })

    doc.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null
      const isLink = Boolean(t?.closest?.('a'))
      const hasSelection = Boolean(this.captureSelection()?.text)
      const p = mapPointToParentViewport(e.clientX, e.clientY, doc)
      this.tapCb?.({ clientX: p.x, clientY: p.y, isLink, hasSelection })
    })
  }

  destroy() {
    if (this.selectionDebounce) window.clearTimeout(this.selectionDebounce)
    this.selectionDebounce = null
    try {
      this.rendition?.destroy()
    } catch {
      /* */
    }
    try {
      this.book?.destroy()
    } catch {
      /* */
    }
    this.book = null
    this.rendition = null
    this.selectionCb = null
    this.tapCb = null
    this.wheelCb = null
    this.progressCb = null
    if (this.container) this.container.innerHTML = ''
  }

  applySettings(settings: ReaderSettings) {
    const prevTurn = this.pageTurn
    this.settings = settings
    this.pageTurn = settings.pageTurn
    if (this.container) applyThemeVars(this.container, effectiveTheme(settings), settings)
    this.applyThemeToRendition(settings)
    // pageTurn only applied at open() before — switch flow live when mode changes
    if (this.rendition && prevTurn !== settings.pageTurn) {
      const flow = settings.pageTurn === 'scroll' ? 'scrolled-doc' : 'paginated'
      try {
        ;(this.rendition as unknown as { flow: (f: string) => void }).flow(flow)
        const mgr = (this.rendition as unknown as { manager?: { overflow?: (o: string) => void } }).manager
        mgr?.overflow?.(settings.pageTurn === 'scroll' ? 'scroll' : 'hidden')
        this.lockEpubHorizontalOverflow()
      } catch (err) {
        console.warn('epub flow switch failed', err)
      }
    }
  }

  getToc() {
    return this.toc
  }

  getProgress() {
    try {
      const loc = this.rendition?.currentLocation() as
        | { start: { cfi: string; index: number }; percentage?: number }
        | undefined
      if (loc) return this.getProgressFromLoc(loc)
    } catch {
      /* */
    }
    return {
      locator: { type: 'epub' as const, spineIndex: this.spineIndex },
      percent: (this.spineIndex / Math.max(1, this.spineLength - 1)) * 100,
    }
  }

  async goTo(locator: Locator) {
    if (locator.type !== 'epub' || !this.rendition) return
    if (locator.cfi) await this.rendition.display(locator.cfi)
    else if (locator.href) await this.rendition.display(locator.href)
    else await this.rendition.display(locator.spineIndex)
    await new Promise((r) => window.setTimeout(r, 50))
    if (this.activeSearchQuery) this.applySearchHighlightToContents()
  }

  async goToPercent(percent: number) {
    if (!this.rendition) return
    const idx = Math.round((Math.min(100, Math.max(0, percent)) / 100) * Math.max(0, this.spineLength - 1))
    await this.rendition.display(idx)
  }

  async next() {
    if (this.pageTurn === 'curl') {
      if (this.curling) return
      this.curling = true
      try {
        await playCurlOut(this.container, 'next')
        await this.rendition?.next()
        await playCurlIn(this.container, 'next')
      } finally {
        this.curling = false
      }
      return
    }
    await this.rendition?.next()
  }

  async prev() {
    if (this.pageTurn === 'curl') {
      if (this.curling) return
      this.curling = true
      try {
        await playCurlOut(this.container, 'prev')
        await this.rendition?.prev()
        await playCurlIn(this.container, 'prev')
      } finally {
        this.curling = false
      }
      return
    }
    await this.rendition?.prev()
  }

  async search(query: string): Promise<SearchHit[]> {
    if (!this.book || !query.trim()) return []
    const q = query.trim()
    const hits: SearchHit[] = []
    const book = this.book
    const request = book.load.bind(book) as (url: string) => Promise<Document>
    type SpineSection = {
      href: string
      index: number
      document?: Document
      load: (req?: (url: string) => Promise<Document>) => Promise<Element>
      unload: () => void
    }
    const spine = book.spine as unknown as { each: (cb: (item: SpineSection) => void) => void }
    const tasks: Promise<void>[] = []
    spine.each((item) => {
      tasks.push(
        (async () => {
          try {
            // epubjs expects book.load, not the Book instance; resolves to documentElement
            const root = await item.load(request)
            const text =
              root?.textContent ||
              item.document?.body?.textContent ||
              item.document?.documentElement?.textContent ||
              ''
            if (!text) return
            let idx = 0
            while (hits.length < 40) {
              const found = indexOfIgnoreCase(text, q, idx)
              if (found < 0) break
              hits.push({
                snippet: `…${text.slice(Math.max(0, found - 16), found + q.length + 16)}…`,
                locator: { type: 'epub', spineIndex: item.index, href: item.href },
              })
              idx = found + Math.max(1, q.length)
            }
          } catch (err) {
            console.warn('epub search chapter failed', item.href, err)
          } finally {
            try {
              item.unload()
            } catch {
              /* */
            }
          }
        })(),
      )
    })
    await Promise.all(tasks)
    return hits.slice(0, 40)
  }

  onProgress(cb: (p: { locator: Locator; percent: number }) => void) {
    this.progressCb = cb
  }

  onWheel(cb: (deltaY: number) => void) {
    this.wheelCb = cb
  }

  onContentTap(cb: (e: ContentTapEvent) => void) {
    this.tapCb = cb
  }

  onSelection(cb: (e: SelectionCaptureEvent | null) => void) {
    this.selectionCb = cb
  }

  highlightSearch(query: string | null) {
    this.activeSearchQuery = query?.trim() || null
    this.applySearchHighlightToContents()
  }

  private applySearchHighlightToContents() {
    const contents = (
      this.rendition as unknown as { getContents?: () => ContentsDoc[] }
    )?.getContents?.()
    if (!contents?.length) return
    for (const c of contents) {
      const body = c.document?.body
      if (!body) continue
      if (!this.activeSearchQuery) {
        clearSearchMarks(body)
        continue
      }
      this.ensureSearchHitStyle(c.document)
      highlightSearchInRoot(body, this.activeSearchQuery, true)
    }
  }

  private ensureSearchHitStyle(doc: Document) {
    const id = 'h5-search-hit-style'
    if (doc.getElementById(id)) return
    const style = doc.createElement('style')
    style.id = id
    style.textContent = `
      mark.search-hit {
        background: #ffe566 !important;
        color: inherit !important;
        border-radius: 2px;
        padding: 0 0.05em;
        box-shadow: 0 0 0 1px rgba(196, 165, 116, 0.55);
      }
    `
    ;(doc.head || doc.documentElement).appendChild(style)
  }

  applyAnnotations(annots: AnnotationRecord[]) {
    if (!this.rendition) return
    try {
      const annotations = (
        this.rendition as unknown as {
          annotations: {
            remove: (cfi: string, type: string) => void
            highlight: (
              cfi: string,
              data: object,
              cb: () => void,
              className: string,
              styles: object,
            ) => void
          }
        }
      ).annotations

      for (const cfi of this.appliedHighlightCfis) {
        try {
          annotations.remove(cfi, 'highlight')
        } catch {
          /* */
        }
      }
      this.appliedHighlightCfis = []

      for (const a of annots) {
        if (a.type !== 'highlight' || a.locator.type !== 'epub' || !a.locator.cfi) continue
        try {
          annotations.highlight(
            a.locator.cfi,
            { id: a.id },
            () => undefined,
            'hl',
            { fill: a.color, 'fill-opacity': '0.45' },
          )
          this.appliedHighlightCfis.push(a.locator.cfi)
        } catch (err) {
          console.warn('epub highlight failed', err)
        }
      }
    } catch (err) {
      console.warn('applyAnnotations failed', err)
    }
  }

  getSelectableText() {
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => { window: Window }[] }
      )?.getContents?.()
      if (!contents?.length) return ''
      return contents
        .map((c) => c.window.document.body?.innerText || '')
        .join('\n')
        .trim()
    } catch {
      return ''
    }
  }

  captureSelection() {
    type ContentsSel = {
      window: Window
      document: Document
      cfiFromRange?: (range: Range, ignoreClass?: string) => string
    }
    const contents = (
      this.rendition as unknown as { getContents: () => ContentsSel[] }
    )?.getContents?.()
    if (!contents?.length) {
      const sel = window.getSelection()
      const text = sel?.toString().trim()
      if (!text) return null
      return {
        text,
        locator: this.getProgress().locator,
        rect: selectionRectFromSel(sel) ?? undefined,
      }
    }
    for (const c of contents) {
      const s = c.window.getSelection()
      if (s && !s.isCollapsed && s.toString().trim()) {
        const text = s.toString().trim()
        let cfi: string | undefined
        try {
          const range = s.getRangeAt(0)
          cfi = c.cfiFromRange?.(range) || undefined
        } catch (err) {
          console.warn('cfiFromRange failed', err)
        }
        let rect = selectionRectFromSel(s)
        if (rect && c.document) rect = mapRectToParentViewport(rect, c.document)
        return {
          text,
          locator: {
            type: 'epub' as const,
            cfi,
            spineIndex: this.spineIndex,
          },
          rect: rect ?? undefined,
        }
      }
    }
    return null
  }

  private applyThemeToRendition(settings: ReaderSettings) {
    if (!this.rendition) return
    const theme = effectiveTheme(settings)
    const bg = theme === 'dark' ? '#12141a' : theme === 'green' ? '#c7e0c7' : theme === 'light' ? '#f7f7f5' : '#f3ead3'
    const fg = theme === 'dark' ? '#e8e6e3' : '#3b2f2f'
    const titleReset = {
      'text-indent': '0 !important',
      'text-align': 'center !important',
      'margin-left': '0 !important',
      'margin-right': '0 !important',
      'padding-left': '0 !important',
      'padding-right': '0 !important',
      float: 'none !important',
      display: 'block !important',
      width: '100% !important',
      'max-width': '100% !important',
      position: 'static !important',
      left: 'auto !important',
      right: 'auto !important',
    }
    this.rendition.themes.default({
      html: {
        'overflow-x': 'hidden !important',
        'max-width': '100% !important',
        'box-sizing': 'border-box !important',
      },
      '*, *::before, *::after': {
        'box-sizing': 'border-box !important',
      },
      body: {
        background: bg,
        color: fg,
        'font-size': `${settings.fontSize}px !important`,
        'line-height': `${settings.lineHeight} !important`,
        'font-family': `${settings.fontFamily} !important`,
        padding: `${settings.marginY}px ${settings.marginX}px !important`,
        margin: '0 !important',
        cursor: 'default !important',
        'caret-color': 'transparent !important',
        'user-select': 'text !important',
        '-webkit-user-select': 'text !important',
        'overflow-x': 'hidden !important',
        'max-width': '100% !important',
        width: '100% !important',
        'box-sizing': 'border-box !important',
        'word-wrap': 'break-word !important',
        'overflow-wrap': 'anywhere !important',
      },
      'img, svg, video, canvas': {
        'max-width': '100% !important',
        'height': 'auto !important',
        'object-fit': 'contain !important',
      },
      table: {
        'max-width': '100% !important',
        'table-layout': 'fixed !important',
        'word-break': 'break-word !important',
      },
      'td, th': {
        'word-break': 'break-word !important',
        'overflow-wrap': 'anywhere !important',
      },
      pre: {
        'max-width': '100% !important',
        'white-space': 'pre-wrap !important',
        'word-break': 'break-word !important',
        'overflow-x': 'hidden !important',
      },
      p: {
        'margin-bottom': `${settings.paragraphGap}em !important`,
        'text-indent': `${settings.indent}em !important`,
        cursor: 'text !important',
        'caret-color': 'transparent !important',
        'user-select': 'text !important',
        '-webkit-user-select': 'text !important',
      },
      'h1, h2, h3, h4, h5, h6': {
        ...titleReset,
        'margin-top': '1.1em !important',
        'margin-bottom': '0.75em !important',
        'line-height': '1.35 !important',
      },
      h1: { 'font-size': '1.45em !important', ...titleReset },
      h2: { 'font-size': '1.28em !important', ...titleReset },
      h3: { 'font-size': '1.15em !important', ...titleReset },
      // Broad title / section heading patterns used by Chinese EPUBs
      'p.title, p.titlepage, p.chapter, p.chapter-title, p.ctitle, p.center, .title, .chapter-title, .chapterTitle, .kindle-cn-title, .contents-title, [class*="title"], [class*="Title"], [class*="chapter-title"], [class*="Chapter"], [class*="CENTER"], [class*="center"]':
        {
          ...titleReset,
          'margin-bottom': `${Math.max(0.6, settings.paragraphGap)}em !important`,
        },
      'p[align="center"], p[align="CENTER"], p[align="right"], p[align="RIGHT"], div[align="center"], div[align="right"], h1[align], h2[align], h3[align]':
        {
          ...titleReset,
        },
      a: {
        cursor: 'pointer !important',
      },
    })
  }

  /**
   * Force-center chapter/section titles that publisher CSS keeps right-aligned
   * or “fake-centers” with indent/margin hacks.
   */
  private normalizeChapterTitles(doc: Document) {
    const applyCenter = (el: HTMLElement) => {
      el.style.setProperty('text-align', 'center', 'important')
      el.style.setProperty('text-indent', '0', 'important')
      el.style.setProperty('margin-left', '0', 'important')
      el.style.setProperty('margin-right', '0', 'important')
      el.style.setProperty('padding-left', '0', 'important')
      el.style.setProperty('padding-right', '0', 'important')
      el.style.setProperty('float', 'none', 'important')
      el.style.setProperty('display', 'block', 'important')
      el.style.setProperty('width', '100%', 'important')
      el.style.setProperty('max-width', '100%', 'important')
      el.style.setProperty('position', 'static', 'important')
      el.style.setProperty('left', 'auto', 'important')
      el.style.setProperty('right', 'auto', 'important')
    }

    const titled = doc.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p.title,p.titlepage,p.chapter,p.chapter-title,p.ctitle,p.center,.title,.chapter-title,.chapterTitle,[class*="title"],[class*="Title"],[class*="chapter-title"],[align="center"],[align="right"],[align="CENTER"],[align="RIGHT"]',
    )
    titled.forEach((node) => {
      if (node instanceof HTMLElement) applyCenter(node)
    })

    // Heuristic: first meaningful block that looks like a short heading (e.g. 「把你的情绪说出来」)
    const body = doc.body
    if (!body) return
    for (const child of Array.from(body.children)) {
      if (!(child instanceof HTMLElement)) continue
      const tag = child.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'img') continue
      const text = (child.textContent || '').replace(/\s+/g, '').trim()
      if (!text) continue
      const looksLikeTitle =
        text.length <= 40 &&
        !text.includes('。') &&
        !text.includes('！') &&
        !text.includes('？') &&
        child.querySelectorAll('p, div').length <= 1
      if (looksLikeTitle) applyCenter(child)
      break
    }
  }

  /** Constrain fixed-size Kindle images / wide media so the reader never needs horizontal scroll. */
  private containOverflowMedia(doc: Document) {
    doc.querySelectorAll('img, svg, video, canvas').forEach((node) => {
      if (!(node instanceof HTMLElement)) return
      node.style.setProperty('max-width', '100%', 'important')
      node.style.setProperty('height', 'auto', 'important')
      node.removeAttribute('width')
      node.removeAttribute('height')
    })
    const html = doc.documentElement
    const body = doc.body
    html?.style.setProperty('overflow-x', 'hidden', 'important')
    html?.style.setProperty('box-sizing', 'border-box', 'important')
    body?.style.setProperty('overflow-x', 'hidden', 'important')
    body?.style.setProperty('max-width', '100%', 'important')
    body?.style.setProperty('width', '100%', 'important')
    body?.style.setProperty('box-sizing', 'border-box', 'important')
    body?.style.setProperty('margin', '0', 'important')

    // epub.js iframe/view can end a few px wider than the stage once a vertical scrollbar appears
    try {
      const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
      if (iframe) {
        iframe.style.maxWidth = '100%'
        iframe.style.width = '100%'
        iframe.style.boxSizing = 'border-box'
        const view = iframe.parentElement
        if (view) {
          view.style.maxWidth = '100%'
          view.style.overflowX = 'hidden'
          view.style.boxSizing = 'border-box'
        }
      }
    } catch {
      /* ignore */
    }
  }

  private getProgressFromLoc(loc: { start: { cfi: string; index: number }; percentage?: number }) {
    const percent =
      typeof loc.percentage === 'number'
        ? loc.percentage * 100
        : (loc.start.index / Math.max(1, this.spineLength - 1)) * 100
    return {
      locator: {
        type: 'epub' as const,
        cfi: loc.start.cfi,
        spineIndex: loc.start.index,
      },
      percent,
    }
  }
}

/** Map EPUB nav to a nested TocItem tree (keeps subitems as children). */
function flattenNav(items: NavItem[], acc: TocItem[] = []): TocItem[] {
  for (const item of items) {
    const id = item.id || item.href
    acc.push({
      id,
      label: item.label?.trim() || '章节',
      locator: { type: 'epub', href: item.href, spineIndex: 0 },
      children: item.subitems?.length ? flattenNav(item.subitems, []) : undefined,
    })
  }
  return acc
}
