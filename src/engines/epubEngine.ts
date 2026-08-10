import ePub, { type Book, type NavItem, type Rendition } from 'epubjs'
import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { applyThemeVars, effectiveTheme, DUAL_COLUMN_MIN_WIDTH, THEME_VARS } from '@/utils/format'
import {
  contrastTextForBackground,
  isDarkDecorativeBackground,
  isTransparentCssColor,
} from '@/utils/colorContrast'
import { buildSelectionEvent, mapPointToParentViewport, mapRectToParentViewport, selectionRectFromSel } from '@/utils/selectionToolbar'
import { clearSearchMarks, highlightSearchInRoot } from '@/utils/domHighlight'
import {
  FULL_ENGINE_CAPABILITIES,
  type ContentGestureEvent,
  type ContentTapEvent,
  type ReadingProgress,
  type ReaderEngine,
  type SearchOptions,
  type SelectionCaptureEvent,
} from './types'
import { createCurlGate, createMarkSurface, createSearchHighlightState } from './shared'
import { injectCaretSuppression } from '@/utils/suppressCaret'
import type { MarkHandleRects } from '@/utils/markSelect'
import { searchEpubBook } from './epubSearch'
import { revokeFontUrlCache, remapBookCssFonts, rewriteEpubFontUrls } from './epubFontUrls'

type ContentsDoc = {
  document: Document
  window: Window
  addStylesheetRules?: (rules: unknown) => void
}

export class EpubEngine implements ReaderEngine {
  readonly capabilities = FULL_ENGINE_CAPABILITIES
  private book: Book | null = null
  private rendition: Rendition | null = null
  private container: HTMLElement | null = null
  private settings: ReaderSettings | null = null
  private toc: TocItem[] = []
  private spineLength = 1
  private spineIndex = 0
  /** EPUB locations.generate finished — enables book-level page estimates. */
  private locationsReady = false
  private locationsGen = 0
  private progressCb: ((p: ReadingProgress) => void) | null = null
  private wheelCb: ((deltaY: number) => void) | null = null
  private tapCb: ((e: ContentTapEvent) => void) | null = null
  private gestureCb: ((e: ContentGestureEvent) => void) | null = null
  private selectionCb: ((e: SelectionCaptureEvent | null) => void) | null = null
  private boundDocs = new WeakSet<Document>()
  /** Keep theme CSS last in iframe docs (publisher styles/scripts often append after head). */
  private themeDocGuards = new WeakMap<Document, MutationObserver>()
  private themeApplyDepth = 0
  /** Ignore MutationObserver echoes from our own inline theme writes. */
  private themeQuietUntil = 0
  /** Pending theme-guard reapply (debounced; avoids height thrash loops). */
  private themeGuardTimers = new WeakMap<Document, number>()
  /** scheduleThemeRepaint timeouts — cleared on destroy / remount. */
  private themeRepaintTimers: number[] = []
  /** blob: URLs for publisher fonts rewritten out of about:srcdoc. */
  private fontUrlCache = new Map<string, string>()
  private pageTurn: PageTurnMode = 'slide'
  /** 划线模式：禁止翻页抢手势，touch-action 放开拖选 */
  private selectMode = false
  private selectionDebounce: number | null = null
  private appliedHighlightCfis: string[] = []
  private readonly curl = createCurlGate()
  private readonly searchHl = createSearchHighlightState()
  private resizeObserver: ResizeObserver | null = null
  private resizeTimer: number | null = null
  private lastSize = { w: 0, h: 0 }
  /** True while page-turn animation runs — ignore ResizeObserver (prevents shake). */
  private layoutLocked = false
  private overflowLocked = false
  private readonly mark = createMarkSurface({
    getDocs: () => {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      )?.getContents?.()
      if (!contents?.length) return []
      return contents.map((c) => c.document).filter(Boolean)
    },
  })

  async open(blob: Blob, settings: ReaderSettings, container: HTMLElement) {
    this.destroy()
    this.container = container
    this.settings = { ...settings }
    this.pageTurn = settings.pageTurn
    container.innerHTML = ''
    container.className = 'epub-reader'
    container.dataset.turn = settings.pageTurn
    applyThemeVars(container, effectiveTheme(settings), settings)

    // Blob URLs lack an .epub extension, so epubjs mis-detects type and never finishes
    // opening. Pass ArrayBuffer so it opens as binary EPUB reliably.
    const data = await blob.arrayBuffer()
    this.book = ePub(data, { replacements: 'blobUrl' })
    await this.book.opened
    await this.book.ready
    // Rewrite font urls inside CSS blobs BEFORE first iframe paint (avoids blocked:other).
    // Do NOT register a serialize hook: epub.js runs serialize hooks in parallel and
    // whatever finishes last wins — overwriting blob image replacements with relative
    // paths (broken <img> in about:srcdoc). Fonts are fixed via remapBookCssFonts +
    // rewriteDocFonts after mount.
    await remapBookCssFonts(this.book, this.fontUrlCache)
    this.spineLength = (this.book.spine as { length?: number }).length || 1
    const nav = this.book.navigation
    this.toc = flattenNav(nav?.toc || [])

    this.rendition = this.book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: settings.pageTurn === 'scroll' ? 'scrolled-doc' : 'paginated',
      // epub.js default overflow "auto" enables BOTH axes; force scroll+vertical so x stays hidden
      overflow: settings.pageTurn === 'scroll' ? 'scroll' : 'hidden',
      spread:
        settings.dualColumn &&
        settings.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
          ? 'always'
          : 'none',
      // Dual spread: modest gap for spine breathing room.
      // Large gap + wrong scroll delta causes bleed — keep this small and tied to dual only.
      gap:
        settings.dualColumn &&
        settings.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
          ? 40
          : 0,
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
    this.syncDualColumnAttr(
      settings.dualColumn &&
        settings.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH,
    )
    {
      const cs = getComputedStyle(container)
      const pl = parseFloat(cs.paddingLeft) || 0
      const pr = parseFloat(cs.paddingRight) || 0
      const pt = parseFloat(cs.paddingTop) || 0
      const pb = parseFloat(cs.paddingBottom) || 0
      this.lastSize = {
        w: Math.max(64, Math.round(container.clientWidth - pl - pr)),
        h: Math.max(64, Math.round(container.clientHeight - pt - pb)),
      }
    }
    this.observeResize(container)

    this.curl.onBusyChange((b) => {
      this.layoutLocked = b
    })

    this.rendition.on('relocated', (...args: unknown[]) => {
      const loc = args[0] as EpubRelocatedLoc
      this.spineIndex = loc.start?.index ?? 0
      this.progressCb?.(this.getProgressFromLoc(loc))
      // Avoid style thrash on every page: lock once; typography only on new iframes (bindContentEvents).
      this.lockEpubHorizontalOverflow()
      this.snapPaginatedScroll()
      // Re-assert theme after page turn — publisher CSS/scripts often repaint late on mobile.
      // Soft path: stylesheet + html/body only (avoids full subtree thrash on dual-column).
      if (this.settings) this.reassertThemeColors(this.settings)
    })

    // Background location map → stable book-level 当前/总页 (estimate).
    this.locationsReady = false
    const gen = ++this.locationsGen
    const locations = (this.book as Book & { locations?: { generate?: (chars: number) => Promise<unknown> } })
      .locations
    void locations?.generate?.(1600)
      ?.then(() => {
        if (gen !== this.locationsGen) return
        this.locationsReady = true
        this.progressCb?.(this.getProgress())
      })
      .catch(() => {
        /* optional — fall back to section / spine pages */
      })
  }

  /**
   * Chrome show/hide changes stage size; epub.js must recompute columns / scroll delta
   * or the next swipe lands between pages (edge bleed / content jumps).
   */
  private observeResize(el: HTMLElement) {
    this.resizeObserver?.disconnect()
    this.resizeObserver = new ResizeObserver(() => {
      // Theme paint / stylesheet reorder can briefly perturb layout; ignore during quiet.
      if (this.layoutLocked || this.themeApplyDepth > 0) return
      if (performance.now() < this.themeQuietUntil) return
      if (this.resizeTimer) window.clearTimeout(this.resizeTimer)
      this.resizeTimer = window.setTimeout(() => this.handleResize(false), 180)
    })
    this.resizeObserver.observe(el)
    const stage = el.parentElement
    if (stage && stage !== el) this.resizeObserver.observe(stage)
  }

  /** Call after reader chrome toggle or other layout changes that resize the stage. */
  resizeToContainer() {
    this.handleResize(true)
  }

  private syncDualColumnAttr(on: boolean) {
    if (!this.container) return
    if (on) this.container.dataset.dual = '1'
    else delete this.container.dataset.dual
  }

  private isDualSpread(settings: ReaderSettings) {
    return (
      settings.dualColumn &&
      settings.pageTurn !== 'scroll' &&
      window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
    )
  }

  private handleResize(force: boolean) {
    if (!this.rendition || !this.container) return
    // Wait one frame so flex layout after v-show has settled
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.applyResize(force))
    })
  }

  private applyResize(force: boolean) {
    if (!this.rendition || !this.container) return
    if (this.layoutLocked && !force) return
    const cs = getComputedStyle(this.container)
    const pl = parseFloat(cs.paddingLeft) || 0
    const pr = parseFloat(cs.paddingRight) || 0
    const pt = parseFloat(cs.paddingTop) || 0
    const pb = parseFloat(cs.paddingBottom) || 0
    // border-box: client* includes padding; epub.js needs the content-box size
    const w = Math.max(64, Math.round(this.container.clientWidth - pl - pr))
    const h = Math.max(64, Math.round(this.container.clientHeight - pt - pb))
    if (!force && Math.abs(w - this.lastSize.w) < 2 && Math.abs(h - this.lastSize.h) < 2) return

    this.lastSize = { w, h }

    // epub.js manager.resize early-returns when _stageSize matches; chrome toggle can
    // update the DOM container via height:100% without going through that path, leaving
    // stale iframe/page metrics. Invalidate so resize always rebuilds views.
    try {
      const mgr = (this.rendition as unknown as { manager?: { _stageSize?: unknown } }).manager
      if (mgr) mgr._stageSize = undefined
    } catch {
      /* */
    }

    try {
      ;(this.rendition as unknown as { resize: (w: number, h: number) => void }).resize(w, h)
    } catch (err) {
      console.warn('epub resize failed', err)
      return
    }
    // rendition.onResized already redisplays current CFI; re-lock + refresh spine inset
    window.setTimeout(() => {
      this.overflowLocked = false
      this.lockEpubHorizontalOverflow()
      this.snapPaginatedScroll()
      if (this.settings) this.applyTypographyToAllContents(this.settings)
      this.containOverflowMediaAll()
    }, 60)
  }

  /**
   * Paginated EPUB: snap .epub-container.scrollLeft to whole pages.
   * Sub-pixel drift after many turns shows adjacent-column glyph slivers on both edges.
   */
  private snapPaginatedScroll() {
    if (this.pageTurn === 'scroll') return
    const root = this.container
    if (!root) return
    const scroller = root.querySelector('.epub-container') as HTMLElement | null
    if (!scroller) return
    const pageW = scroller.clientWidth
    if (pageW < 8) return
    const max = Math.max(0, scroller.scrollWidth - pageW)
    const raw = scroller.scrollLeft
    const snapped = Math.min(max, Math.max(0, Math.round(raw / pageW) * pageW))
    if (Math.abs(raw - snapped) >= 0.5) {
      scroller.scrollLeft = snapped
    }
    // Ensure the stage clips any residual column paint outside the page box.
    root.style.setProperty('overflow', 'hidden', 'important')
    scroller.style.setProperty('overflow-x', 'hidden', 'important')
    scroller.style.setProperty('overflow-y', 'hidden', 'important')
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
      } else {
        container.style.setProperty('overflow-y', 'hidden', 'important')
      }
      container.style.maxWidth = '100%'
      container.style.boxSizing = 'border-box'
    }
    // Paginated: after first successful view lock, skip re-mutating every relocated (reduces jitter).
    // Overflow clip above still runs every call.
    if (this.pageTurn !== 'scroll' && this.overflowLocked) return

    // Only clamp view/iframe width in continuous scroll mode.
    // Paginated: epub.js expand() needs views wider than the viewport.
    if (this.pageTurn === 'scroll') {
      this.overflowLocked = false
      root.querySelectorAll('.epub-view, .epub-view iframe').forEach((el) => {
        if (!(el instanceof HTMLElement)) return
        el.style.maxWidth = '100%'
        el.style.boxSizing = 'border-box'
        if (el.classList.contains('epub-view')) el.style.overflowX = 'hidden'
      })
    } else {
      root.querySelectorAll('.epub-view, .epub-view iframe').forEach((el) => {
        if (!(el instanceof HTMLElement)) return
        el.style.removeProperty('max-width')
        if (el.style.width === '100%') el.style.removeProperty('width')
        if (el.classList.contains('epub-view')) {
          el.style.overflow = 'hidden'
          el.style.removeProperty('overflow-x')
        }
      })
      this.overflowLocked = true
    }
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

  private syncDocTouchAction(doc: Document) {
    const root = doc.documentElement
    if (!root) return
    if (this.selectMode) {
      root.style.touchAction = 'auto'
      root.dataset.qyTurn = 'select'
    } else if (this.pageTurn === 'scroll') {
      root.style.touchAction = 'pan-y'
      root.dataset.qyTurn = 'scroll'
    } else {
      root.style.touchAction = 'manipulation'
      root.dataset.qyTurn = 'paged'
    }
    if (doc.body) {
      doc.body.style.webkitUserSelect = 'text'
      doc.body.style.userSelect = 'text'
    }
  }

  private syncAllDocsTouchAction() {
    const contents = (
      this.rendition as unknown as { getContents?: () => ContentsDoc[] }
    )?.getContents?.()
    if (!contents?.length) return
    for (const c of contents) {
      const doc = c.document
      if (doc) this.syncDocTouchAction(doc)
    }
  }

  private bindContentEvents(contents: ContentsDoc) {
    const doc = contents.document
    if (!doc || this.boundDocs.has(doc)) return
    this.boundDocs.add(doc)

    injectCaretSuppression(doc)

    this.normalizeChapterTitles(doc)
    if (this.settings) {
      this.applyThemeColorsToDocument(doc, this.settings, true)
      this.applyTypographyToDocument(doc, this.settings)
      this.scheduleThemeRepaint(doc)
    }
    // After theme paint so inline media caps win; re-fit when late images decode.
    this.containOverflowMedia(doc)
    doc.querySelectorAll('img').forEach((img) => {
      if (!(img instanceof HTMLImageElement)) return
      if (img.complete) return
      img.addEventListener(
        'load',
        () => {
          if (!doc.defaultView || doc.defaultView.closed) return
          this.containOverflowMedia(doc)
        },
        { once: true },
      )
    })
    // Publisher @font-face relative urls resolve to about:srcdoc and Chrome blocks them.
    void this.rewriteDocFonts(doc)
    this.syncDocTouchAction(doc)

    // Re-apply search marks when chapter iframe mounts / remounts
    if (this.searchHl.get() && doc.body) {
      this.ensureSearchHitStyle(doc)
      window.setTimeout(() => {
        const q = this.searchHl.get()
        if (q && doc.body) {
          highlightSearchInRoot(doc.body, q, true)
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
    let selectingWithPointer = false
    let lastPtr: PointerEvent | null = null
    let longPressTimer: number | null = null
    let localSwipe: {
      id: number
      x0: number
      y0: number
      t0: number
      dragging: boolean
    } | null = null

    const LONG_PRESS_MS = 320

    const selectionBusy = () => {
      const sel = doc.getSelection()
      return Boolean(sel && !sel.isCollapsed && sel.toString().trim())
    }

    const emitGesture = (
      phase: ContentGestureEvent['phase'],
      e: PointerEvent,
    ) => {
      const p = mapPointToParentViewport(e.clientX, e.clientY, doc)
      this.gestureCb?.({
        phase,
        pointerId: e.pointerId,
        clientX: p.x,
        clientY: p.y,
        pointerType: e.pointerType || 'touch',
      })
    }

    const clearLongPressTimer = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    /** Cancel page-swipe tracking (optionally keep finger free for selection). */
    const abortSwipe = (e?: PointerEvent) => {
      clearLongPressTimer()
      if (!localSwipe) return
      const ev = e || lastPtr
      localSwipe = null
      if (ev) emitGesture('cancel', ev)
    }

    /** Yield this finger to native selection / handle drag. */
    const yieldToSelection = (e?: PointerEvent) => {
      selectingWithPointer = true
      abortSwipe(e)
    }

    doc.addEventListener('selectionchange', () => {
      if (pointerDown && selectionBusy()) {
        yieldToSelection()
        return
      }
      if (pointerDown) return
      if (!selectionBusy()) return
      this.scheduleEmitSelection()
    })

    doc.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null
      const isLink = Boolean(t?.closest?.('a'))
      const hasSelection = Boolean(this.captureSelection()?.text)
      const p = mapPointToParentViewport(e.clientX, e.clientY, doc)
      this.tapCb?.({ clientX: p.x, clientY: p.y, isLink, hasSelection })
    })

    // Bridge swipe/drag to reader shell — yield to text selection (long-press / drag handles).
    doc.addEventListener(
      'pointerdown',
      (e) => {
        pointerDown = true
        selectingWithPointer = false
        lastPtr = e
        clearLongPressTimer()
        // 划线模式：把指针事件交给壳层做自建拖选
        if (this.selectMode) {
          selectingWithPointer = true
          emitGesture('start', e)
          return
        }
        if (selectionBusy()) {
          selectingWithPointer = true
          return
        }
        if (this.pageTurn === 'scroll') return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const t = e.target as HTMLElement | null
        if (t?.closest?.('a, button, input, textarea')) return
        localSwipe = {
          id: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          t0: Date.now(),
          dragging: false,
        }
        emitGesture('start', e)
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null
          if (localSwipe && localSwipe.id === e.pointerId && !localSwipe.dragging) {
            emitGesture('longpress', e)
            yieldToSelection(e)
          }
        }, LONG_PRESS_MS)
      },
      { passive: true },
    )

    doc.addEventListener(
      'pointermove',
      (e) => {
        lastPtr = e
        if (this.selectMode) {
          emitGesture('move', e)
          return
        }
        if (selectingWithPointer) return
        if (!localSwipe || localSwipe.id !== e.pointerId) return
        if (selectionBusy()) {
          emitGesture('longpress', e)
          yieldToSelection(e)
          return
        }
        const dx = e.clientX - localSwipe.x0
        const dy = e.clientY - localSwipe.y0
        const held = Date.now() - localSwipe.t0
        if (!localSwipe.dragging) {
          if (held >= LONG_PRESS_MS) {
            emitGesture('longpress', e)
            yieldToSelection(e)
            return
          }
          if (Math.abs(dx) < 28 && Math.abs(dy) < 28) return
          if (Math.abs(dy) > Math.abs(dx) * 1.05) {
            abortSwipe(e)
            return
          }
          if (Math.abs(dx) < Math.abs(dy) * 1.35) {
            abortSwipe(e)
            return
          }
          clearLongPressTimer()
          localSwipe.dragging = true
          try {
            doc.documentElement.setPointerCapture?.(e.pointerId)
          } catch {
            /* */
          }
        }
        e.preventDefault()
        emitGesture('move', e)
      },
      { passive: false },
    )

    const endPointer = (phase: 'end' | 'cancel', e: PointerEvent) => {
      pointerDown = false
      lastPtr = e
      clearLongPressTimer()
      if (this.selectMode) {
        selectingWithPointer = false
        emitGesture(phase, e)
        return
      }
      const hadSwipe = localSwipe && localSwipe.id === e.pointerId
      const wasDrag = Boolean(hadSwipe && localSwipe!.dragging)
      const wasSelecting = selectingWithPointer || selectionBusy()
      if (hadSwipe) {
        localSwipe = null
        emitGesture(phase, e)
      }
      selectingWithPointer = false
      if (!wasDrag || wasSelecting) {
        const p = mapPointToParentViewport(e.clientX, e.clientY, doc)
        this.scheduleEmitSelection(p.x, p.y)
      }
    }

    doc.addEventListener('pointerup', (e) => endPointer('end', e), { passive: true })
    doc.addEventListener('pointercancel', (e) => endPointer('cancel', e), { passive: true })
  }

  destroy() {
    if (this.selectionDebounce) window.clearTimeout(this.selectionDebounce)
    this.selectionDebounce = null
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer)
    this.resizeTimer = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    for (const t of this.themeRepaintTimers) window.clearTimeout(t)
    this.themeRepaintTimers = []
    this.mark.reset()
    revokeFontUrlCache(this.fontUrlCache)
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      )?.getContents?.()
      contents?.forEach((c) => {
        const doc = c.document
        if (!doc) return
        const guardTimer = this.themeGuardTimers.get(doc)
        if (guardTimer) window.clearTimeout(guardTimer)
        this.themeGuardTimers.delete(doc)
        this.themeDocGuards.get(doc)?.disconnect()
        this.themeDocGuards.delete(doc)
      })
    } catch {
      /* */
    }
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
    this.locationsReady = false
    this.locationsGen += 1
    this.selectionCb = null
    this.tapCb = null
    this.gestureCb = null
    this.wheelCb = null
    this.progressCb = null
    if (this.container) this.container.innerHTML = ''
  }

  applySettings(settings: ReaderSettings) {
    const prevTurn = this.pageTurn
    const prev = this.settings
    this.settings = { ...settings }
    this.pageTurn = settings.pageTurn
    this.overflowLocked = false
    if (this.container) {
      this.container.dataset.turn = settings.pageTurn
      applyThemeVars(this.container, effectiveTheme(settings), settings)
    }
    this.syncAllDocsTouchAction()
    this.applyThemeToRendition(settings)
    this.applyTypographyToAllContents(settings)

    const scrollMode = settings.pageTurn === 'scroll'
    const prevScrollMode = prevTurn === 'scroll'
    const flowChanged = scrollMode !== prevScrollMode

    // pageTurn only applied at open() before — switch flow live when scroll↔paged flips
    if (this.rendition && flowChanged) {
      const flow = scrollMode ? 'scrolled-doc' : 'paginated'
      try {
        ;(this.rendition as unknown as { flow: (f: string) => void }).flow(flow)
        const mgr = (this.rendition as unknown as { manager?: { overflow?: (o: string) => void } }).manager
        mgr?.overflow?.(scrollMode ? 'scroll' : 'hidden')
        this.lockEpubHorizontalOverflow()
      } catch (err) {
        console.warn('epub flow switch failed', err)
      }
    }

    // Dual-column spread: only paginated + wide screen
    const wantSpread = this.isDualSpread(settings)
    const prevWantSpread = !!prev && this.isDualSpread({ ...prev, pageTurn: prevTurn })
    const spreadChanged = wantSpread !== prevWantSpread
    // Full clear+display only when column geometry changes. slide↔curl stays paginated —
    // do NOT rebuild+resize together (race leaves a blank first page until next turn).
    if (this.rendition && (spreadChanged || flowChanged)) {
      void this.rebuildForSpread(wantSpread)
      return
    }

    this.syncDualColumnAttr(wantSpread)
    // Margins / font metrics change the content box — must re-paginate.
    const metricsChanged =
      !prev ||
      prev.marginX !== settings.marginX ||
      prev.marginY !== settings.marginY ||
      prev.fontSize !== settings.fontSize ||
      prev.lineHeight !== settings.lineHeight ||
      prev.paragraphGap !== settings.paragraphGap ||
      prev.indent !== settings.indent ||
      prev.fontFamily !== settings.fontFamily
    if (metricsChanged) {
      this.resizeToContainer()
    } else if (prevTurn !== settings.pageTurn) {
      // slide↔curl: chrome/dataset only — snap + drop leftover turn classes
      this.snapPaginatedScroll()
      this.clearTurnArtifacts()
    }
  }

  /**
   * Hot-toggle dual spread: gap must live on manager.settings, and views must be
   * cleared + redisplayed — updateLayout alone leaves stale columns until refresh.
   */
  private async rebuildForSpread(wantSpread: boolean) {
    if (!this.rendition) return
    const rendition = this.rendition as unknown as {
      settings: { gap: number }
      manager?: {
        settings: { gap: number }
        clear: () => void
      }
      spread: (s: string) => void
      display: (target?: string | number) => Promise<unknown>
      currentLocation: () => { start?: { cfi?: string } }
    }
    const gap = wantSpread ? 40 : 0
    rendition.settings.gap = gap
    if (rendition.manager?.settings) rendition.manager.settings.gap = gap

    try {
      rendition.spread(wantSpread ? 'always' : 'none')
    } catch (err) {
      console.warn('epub spread switch failed', err)
    }
    this.syncDualColumnAttr(wantSpread)

    let cfi: string | undefined
    try {
      cfi = rendition.currentLocation()?.start?.cfi
    } catch {
      /* */
    }

    try {
      rendition.manager?.clear?.()
    } catch {
      /* */
    }

    // Force resize path even if stage px unchanged
    this.lastSize = { w: 0, h: 0 }
    this.resizeToContainer()

    try {
      if (cfi) await rendition.display(cfi)
      else await rendition.display()
    } catch (err) {
      console.warn('epub redisplay after spread failed', err)
    }

    // Let columns paint, then snap scrollLeft — mid-column offset looks like a blank page.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    this.overflowLocked = false
    this.lockEpubHorizontalOverflow()
    this.snapPaginatedScroll()
    this.clearTurnArtifacts()
    if (this.settings) this.applyTypographyToAllContents(this.settings)
    this.containOverflowMediaAll()
  }

  getToc() {
    return this.toc
  }

  getProgress(): ReadingProgress {
    try {
      const loc = this.rendition?.currentLocation() as EpubRelocatedLoc | undefined
      if (loc?.start) return this.getProgressFromLoc(loc)
    } catch {
      /* */
    }
    return {
      locator: { type: 'epub' as const, spineIndex: this.spineIndex },
      percent: (this.spineIndex / Math.max(1, this.spineLength - 1)) * 100,
      page: this.spineIndex + 1,
      pageCount: Math.max(1, this.spineLength),
      pageMode: 'estimate',
    }
  }

  async goTo(locator: Locator) {
    if (locator.type !== 'epub' || !this.rendition) return
    if (locator.cfi) await this.rendition.display(locator.cfi)
    else if (locator.href) await this.rendition.display(locator.href)
    else await this.rendition.display(locator.spineIndex)
    await new Promise((r) => window.setTimeout(r, 50))
    if (this.searchHl.get()) this.applySearchHighlightToContents()
  }

  async goToPercent(percent: number) {
    if (!this.rendition) return
    const idx = Math.round((Math.min(100, Math.max(0, percent)) / 100) * Math.max(0, this.spineLength - 1))
    await this.rendition.display(idx)
  }

  async next() {
    await this.curl.run(this.pageTurn, this.container, 'next', async () => {
      await this.turnPage('next')
    })
  }

  async prev() {
    await this.curl.run(this.pageTurn, this.container, 'prev', async () => {
      await this.turnPage('prev')
    })
  }

  /** Advance/rewind and wait until epub.js finishes relocating (layout stable). */
  private async turnPage(dir: 'next' | 'prev') {
    if (!this.rendition) return
    const rendition = this.rendition as unknown as {
      on: (e: string, fn: () => void) => void
      off: (e: string, fn: () => void) => void
      next: () => Promise<unknown>
      prev: () => Promise<unknown>
    }
    const relocated = new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        rendition.off('relocated', onRelocated)
        resolve()
      }, 400)
      const onRelocated = () => {
        window.clearTimeout(timer)
        rendition.off('relocated', onRelocated)
        resolve()
      }
      rendition.on('relocated', onRelocated)
    })
    try {
      if (dir === 'next') await rendition.next()
      else await rendition.prev()
    } catch {
      /* at bound */
    }
    await relocated
    // Double-rAF: paint settles, then snap out any mid-column scrollLeft drift.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    this.snapPaginatedScroll()
    this.clearTurnArtifacts()
  }

  /** Soft-turn / drag chrome must not leave transform/filter on the live surface. */
  private clearTurnArtifacts() {
    const root = this.container
    if (!root) return
    root.style.removeProperty('transform')
    root.style.removeProperty('filter')
    root.style.removeProperty('box-shadow')
    root.style.removeProperty('will-change')
    root.style.removeProperty('opacity')
    root.style.removeProperty('visibility')
    root.classList.remove(
      'slide-hold',
      'slide-out-next',
      'slide-out-prev',
      'slide-in-next',
      'slide-in-prev',
      'curl-hold',
      'curl-out-next',
      'curl-out-prev',
      'curl-in-next',
      'curl-in-prev',
      'curl-under-next',
      'curl-under-prev',
    )
    const host = root.parentElement
    if (host) {
      host.style.removeProperty('perspective')
    }
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    if (!this.book || !query.trim()) return []
    return searchEpubBook(this.book, query, opts)
  }

  onProgress(cb: (p: ReadingProgress) => void) {
    this.progressCb = cb
  }

  onWheel(cb: (deltaY: number) => void) {
    this.wheelCb = cb
  }

  onContentTap(cb: (e: ContentTapEvent) => void) {
    this.tapCb = cb
  }

  onContentGesture(cb: (e: ContentGestureEvent) => void) {
    this.gestureCb = cb
  }

  onSelection(cb: (e: SelectionCaptureEvent | null) => void) {
    this.selectionCb = cb
  }

  setSelectMode(active: boolean) {
    this.selectMode = active
    this.syncAllDocsTouchAction()
    if (this.container) {
      this.container.classList.toggle('select-mode', active)
    }
    // iframe 内也用绿色选区，贴近华为阅读
    const contents = (
      this.rendition as unknown as { getContents?: () => ContentsDoc[] }
    )?.getContents?.()
    if (!contents?.length) return
    for (const c of contents) {
      const doc = c.document
      if (!doc) continue
      let style = doc.getElementById('qy-mark-selection') as HTMLStyleElement | null
      if (active) {
        if (!style) {
          style = doc.createElement('style')
          style.id = 'qy-mark-selection'
          style.textContent =
            '::selection, *::selection { background: rgba(61, 155, 95, 0.35) !important; color: inherit !important; }'
          ;(doc.head || doc.documentElement).appendChild(style)
        }
      } else {
        style?.remove()
      }
    }
  }

  clearNativeSelection() {
    this.mark.endAll()
    const contents = (
      this.rendition as unknown as { getContents?: () => ContentsDoc[] }
    )?.getContents?.()
    if (!contents?.length) return
    for (const c of contents) {
      try {
        c.document.getSelection()?.removeAllRanges()
      } catch {
        /* */
      }
    }
  }

  markDrag(phase: 'start' | 'move' | 'end', clientX: number, clientY: number): MarkHandleRects | null {
    return this.mark.markDrag(phase, clientX, clientY)
  }

  markHandle(
    phase: 'start' | 'move' | 'end',
    which: 'start' | 'end',
    clientX: number,
    clientY: number,
  ): MarkHandleRects | null {
    return this.mark.markHandle(phase, which, clientX, clientY)
  }

  getMarkHandleRects(): MarkHandleRects | null {
    return this.mark.getMarkHandleRects()
  }

  highlightSearch(query: string | null) {
    this.searchHl.set(query)
    this.applySearchHighlightToContents()
  }

  private applySearchHighlightToContents() {
    const contents = (
      this.rendition as unknown as { getContents?: () => ContentsDoc[] }
    )?.getContents?.()
    if (!contents?.length) return
    const q = this.searchHl.get()
    for (const c of contents) {
      const body = c.document?.body
      if (!body) continue
      if (!q) {
        clearSearchMarks(body)
        continue
      }
      this.ensureSearchHitStyle(c.document)
      highlightSearchInRoot(body, q, true)
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
        this.rendition as unknown as {
          getContents?: () => { window: Window; document?: Document }[]
        }
      )?.getContents?.()
      if (!contents?.length) return ''
      const parts = contents.map((c) => {
        const doc = c.document || c.window?.document
        return (
          doc?.body?.innerText ||
          doc?.documentElement?.innerText ||
          doc?.body?.textContent ||
          ''
        )
      })
      return parts.join('\n').replace(/\s+\n/g, '\n').trim()
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

  /** epub.js addStylesheetRules only appends; clear so typography updates replace cleanly. */
  private clearInjectedThemeStyles() {
    if (!this.rendition) return
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      ).getContents?.()
      contents?.forEach((c) => {
        const doc = c.document
        if (!doc) return
        const el = doc.getElementById('epubjs-inserted-css-default')
        if (!el) return
        // Rules were inserted via CSSOM (not textContent) — remove node so next inject is fresh.
        el.remove()
      })
    } catch {
      /* */
    }
  }

  /**
   * Publisher CSS often sets font-* on `.class` with !important, which beats
   * body/p theme rules (class specificity). Inject a dedicated stylesheet with
   * html body …[class] selectors, plus inline fallback after layout settles.
   */
  private typographyFingerprint(settings: ReaderSettings) {
    return [
      settings.fontSize,
      settings.lineHeight,
      settings.fontFamily,
      settings.paragraphGap,
      settings.indent,
      settings.pageTurn,
    ].join('\0')
  }

  private applyTypographyToDocument(doc: Document, settings: ReaderSettings) {
    const body = doc.body
    if (!body) return

    const fp = this.typographyFingerprint(settings)
    const id = 'qingyue-typography'
    let styleEl = doc.getElementById(id) as HTMLStyleElement | null
    // Idempotent: rewriting textContent/inline styles forces reflow and looks like
    // fonts "jumping" on every page turn even when settings did not change.
    if (styleEl?.textContent && body.dataset.qyTypography === fp) return

    if (!styleEl) {
      styleEl = doc.createElement('style')
      styleEl.id = id
      doc.head.appendChild(styleEl)
    }
    // Escape is unnecessary for numeric settings; font-family is from our presets.
    // Do NOT add body horizontal padding in paginated/spread mode — it desyncs
    // epub.js column width vs scroll delta and causes multi-column bleed.
    const padCss =
      settings.pageTurn === 'scroll'
        ? ''
        : `
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;`

    styleEl.textContent = `
html body {
  font-size: ${settings.fontSize}px !important;
  line-height: ${settings.lineHeight} !important;
  font-family: ${settings.fontFamily} !important;${padCss}
}
html body p,
html body div,
html body li,
html body td,
html body th,
html body blockquote,
html body section,
html body article,
html body span,
html body p[class],
html body div[class],
html body li[class],
html body span[class],
html body td[class],
html body th[class],
html body blockquote[class],
html body section[class],
html body article[class] {
  font-size: inherit !important;
  line-height: inherit !important;
  font-family: inherit !important;
}
html body p,
html body p[class] {
  margin-top: 0 !important;
  margin-bottom: ${settings.paragraphGap}em !important;
  text-indent: ${settings.indent}em !important;
}
html body h1,
html body h2,
html body h3,
html body h4,
html body h5,
html body h6 {
  font-family: ${settings.fontFamily} !important;
}
`.trim()

    body.style.setProperty('font-size', `${settings.fontSize}px`, 'important')
    body.style.setProperty('line-height', String(settings.lineHeight), 'important')
    body.style.setProperty('font-family', settings.fontFamily, 'important')
    if (settings.pageTurn !== 'scroll') {
      body.style.setProperty('padding-left', '0', 'important')
      body.style.setProperty('padding-right', '0', 'important')
      body.style.setProperty('padding-top', '0', 'important')
      body.style.setProperty('padding-bottom', '0', 'important')
    }
    body.dataset.qyTypography = fp
  }

  private applyTypographyToAllContents(settings: ReaderSettings) {
    if (!this.rendition) return
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      ).getContents?.()
      contents?.forEach((c) => {
        if (c.document) this.applyTypographyToDocument(c.document, settings)
      })
    } catch {
      /* */
    }
  }

  private themeColors(settings: ReaderSettings) {
    const theme = effectiveTheme(settings)
    const vars = THEME_VARS[theme]
    return {
      theme,
      bg: vars['--reader-bg'],
      fg: vars['--reader-fg'],
    }
  }

  private async rewriteDocFonts(doc: Document) {
    if (!this.book) return
    try {
      await rewriteEpubFontUrls(doc, this.book, this.fontUrlCache)
    } catch (err) {
      console.warn('epub font url rewrite failed', err)
    }
  }

  /**
   * Append theme stylesheet as the last node under <html> (after <body>).
   * Head-only injection loses to publisher/script <style> tags appended in body —
   * common on mobile CN Kindle EPUBs (dark/green washes).
   */
  private pinThemeStyleLast(doc: Document, styleEl: HTMLStyleElement) {
    const root = doc.documentElement
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
    root.appendChild(styleEl)
  }

  private ensureThemeDocGuard(doc: Document) {
    if (this.themeDocGuards.has(doc)) return
    const scheduleReapply = (force: boolean) => {
      if (this.themeApplyDepth > 0 || !this.settings) return
      if (performance.now() < this.themeQuietUntil) return
      if (!doc.defaultView || doc.defaultView.closed) return
      const prev = this.themeGuardTimers.get(doc)
      if (prev) window.clearTimeout(prev)
      const settings = this.settings
      const timer = window.setTimeout(() => {
        this.themeGuardTimers.delete(doc)
        if (!this.settings || this.settings !== settings) return
        if (!doc.defaultView || doc.defaultView.closed) return
        if (this.themeApplyDepth > 0 || performance.now() < this.themeQuietUntil) return
        // Soft by default: full wash only when our theme sheet lost cascade order.
        this.applyThemeColorsToDocument(doc, settings, force)
      }, 120)
      this.themeGuardTimers.set(doc, timer)
    }
    const observer = new MutationObserver((mutations) => {
      if (this.themeApplyDepth > 0 || performance.now() < this.themeQuietUntil) return
      for (const m of mutations) {
        if (m.type === 'attributes') {
          const t = m.target
          if (t === doc.documentElement || t === doc.body) {
            scheduleReapply(false)
            return
          }
          continue
        }
        if (m.type !== 'childList') continue
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue
          if (n.id === 'qingyue-theme' || n.id === 'qingyue-typography') continue
          const tag = n.tagName
          if (
            tag === 'STYLE' ||
            (tag === 'LINK' && (n as HTMLLinkElement).rel === 'stylesheet')
          ) {
            scheduleReapply(true)
            return
          }
          if (n.querySelector?.('style, link[rel="stylesheet"]')) {
            scheduleReapply(true)
            return
          }
        }
      }
    })
    observer.observe(doc.documentElement, {
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    if (doc.head) observer.observe(doc.head, { childList: true, subtree: true })
    if (doc.body) {
      // childList + style/class on body — skip deep attribute watch (column layout thrash).
      observer.observe(doc.body, {
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      })
    }
    this.themeDocGuards.set(doc, observer)

    const onSheet = () => scheduleReapply(true)
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      link.addEventListener('load', onSheet)
      link.addEventListener('error', onSheet)
    })
  }

  /**
   * Beat publisher EPUB CSS (often dark/green body with light text) so iframe
   * colors match the reader chrome theme on phone/tablet/PC.
   *
   * Important: do NOT paint `background-color` on every descendant — that fights
   * CSS-background illustrations and can composite over figures. Only force
   * html/body + solid color washes; leave url(...) backgrounds alone.
   */
  private applyThemeColorsToDocument(doc: Document, settings: ReaderSettings, force = false) {
    const { theme, bg, fg } = this.themeColors(settings)
    const fp = `${theme}\0${bg}\0${fg}`
    const root = doc.documentElement
    const id = 'qingyue-theme'
    let styleEl = doc.getElementById(id) as HTMLStyleElement | null

    this.themeApplyDepth += 1
    try {
      // Idempotent soft path: rewriting the huge theme sheet + walking washes
      // forces layout and looks like height flicker on PC chapter views.
      // Only full-rebuild when fingerprint changed or stylesheet is missing.
      if (styleEl?.textContent && root.dataset.qyTheme === fp) {
        const needsPin = root.lastElementChild !== styleEl
        if (needsPin) this.pinThemeStyleLast(doc, styleEl)
        root.style.setProperty('background-color', bg, 'important')
        root.style.setProperty('background-image', 'none', 'important')
        root.style.setProperty('color', fg, 'important')
        const body = doc.body
        if (body) {
          body.style.setProperty('background-color', bg, 'important')
          body.style.setProperty('background-image', 'none', 'important')
          body.style.setProperty('color', fg, 'important')
          body.style.setProperty('-webkit-text-fill-color', fg, 'important')
          // Always re-run contrast wash: dark figure bars need light text (soft path too).
          this.paintPublisherWashes(doc, bg, fg)
        }
        this.paintHostSurfaces(doc, bg)
        this.ensureThemeDocGuard(doc)
        return
      }

      if (!styleEl) {
        styleEl = doc.createElement('style')
        styleEl.id = id
      }
      this.pinThemeStyleLast(doc, styleEl)

      const scheme = theme === 'dark' ? 'dark' : 'light'
      // Match typography specificity: publisher Kindle CSS uses .class !important.
      // :where() has zero specificity and loses — that made only near-green washes
      // look "correct" while sepia/light/dark never stuck on mobile.
      const textSel = [
        'p',
        'div',
        'li',
        'span',
        'a',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'td',
        'th',
        'blockquote',
        'em',
        'strong',
        'b',
        'i',
        'u',
        'small',
        'label',
        'font',
        'section',
        'article',
        'pre',
        'code',
        'figure',
        'figcaption',
        'caption',
        'cite',
      ]
        .flatMap((t) => [`html body ${t}`, `html body ${t}[class]`, `html body ${t}[style]`])
        .join(',\n')
      const captionSel = [
        'html body figcaption',
        'html body figcaption[class]',
        'html body caption',
        'html body caption[class]',
        'html body cite',
        'html body [class*="caption"]',
        'html body [class*="Caption"]',
        'html body [class*="CAPTION"]',
        'html body [class*="image-title"]',
        'html body [class*="img-title"]',
        'html body [class*="pic-title"]',
        'html body [class*="fuming"]',
      ].join(',\n')
      styleEl.textContent = `
html {
  color-scheme: ${scheme} !important;
  background-color: ${bg} !important;
  background-image: none !important;
  color: ${fg} !important;
}
html body,
html body[class],
html body[style] {
  background-color: ${bg} !important;
  background-image: none !important;
  color: ${fg} !important;
  -webkit-text-fill-color: ${fg} !important;
}
${textSel} {
  color: ${fg} !important;
  -webkit-text-fill-color: ${fg} !important;
}
/* Caption opacity only — text color comes from contrast wash (dark pills → light glyphs). */
${captionSel} {
  opacity: 1 !important;
}
html body img,
html body img[class],
html body svg,
html body video,
html body canvas,
html body picture,
html body object,
html body embed {
  background-color: transparent !important;
  -webkit-text-fill-color: initial !important;
  color: inherit !important;
  /* 100vw = iframe page width; 100% fails inside epub.js multicol (spills to next page). */
  max-width: 100vw !important;
  max-height: 92vh !important;
  object-fit: contain !important;
  box-sizing: border-box !important;
  break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
html body img,
html body img[class],
html body video,
html body canvas {
  width: auto !important;
  height: auto !important;
}
html body :has(> img):not(body),
html body :has(> svg):not(body),
html body :has(> picture):not(body),
html body :has(> video):not(body),
html body :has(> canvas):not(body) {
  background-color: transparent !important;
  max-width: 100vw !important;
  box-sizing: border-box !important;
}
`.trim()

      root.style.setProperty('background-color', bg, 'important')
      root.style.setProperty('background-image', 'none', 'important')
      root.style.setProperty('color', fg, 'important')
      const body = doc.body
      if (body) {
        body.style.setProperty('background-color', bg, 'important')
        body.style.setProperty('background-image', 'none', 'important')
        body.style.setProperty('color', fg, 'important')
        body.style.setProperty('-webkit-text-fill-color', fg, 'important')
        this.paintPublisherWashes(doc, bg, fg)
      }
      root.dataset.qyTheme = fp
      this.paintHostSurfaces(doc, bg)
      this.ensureThemeDocGuard(doc)
    } finally {
      this.themeApplyDepth -= 1
      // Quiet long enough to absorb MutationObserver + ResizeObserver echoes.
      this.themeQuietUntil = performance.now() + 220
    }
  }

  /**
   * Override publisher color washes with theme colors, but keep dark decorative
   * surfaces (black figure-title pills) and put light text on them for contrast.
   */
  private paintPublisherWashes(doc: Document, bg: string, fg: string) {
    const win = doc.defaultView
    const body = doc.body
    if (!win || !body) return

    const isMedia = (tag: string) =>
      tag === 'img' ||
      tag === 'svg' ||
      tag === 'video' ||
      tag === 'canvas' ||
      tag === 'picture' ||
      tag === 'object' ||
      tag === 'embed' ||
      tag === 'source' ||
      tag === 'script' ||
      tag === 'style' ||
      tag === 'link'

    const hasUrlBackground = (el: HTMLElement, cs: CSSStyleDeclaration) => {
      const inline = el.getAttribute('style') || ''
      if (/background(-image)?\s*:[^;]*url\(/i.test(inline)) return true
      const bi = cs.backgroundImage
      return !!bi && bi !== 'none' && /url\(/i.test(bi)
    }

    const applyText = (el: HTMLElement, color: string) => {
      el.style.setProperty('color', color, 'important')
      el.style.setProperty('-webkit-text-fill-color', color, 'important')
      if (/caption|fuming|img-title|image-title|pic-title|tu-ti/i.test(el.className || '')) {
        el.style.setProperty('opacity', '1', 'important')
      }
    }

    const walk = (el: HTMLElement, depth: number, inheritedFg: string) => {
      if (depth > 8) return
      const tag = el.tagName.toLowerCase()
      if (isMedia(tag)) return
      if (el.id === 'qingyue-theme' || el.id === 'qingyue-typography') return

      let cs: CSSStyleDeclaration
      try {
        cs = win.getComputedStyle(el)
      } catch {
        return
      }

      const kids = Array.from(el.children).filter((n) => n instanceof HTMLElement) as HTMLElement[]
      const urlBg = hasUrlBackground(el, cs)
      const mediaOnly =
        kids.length > 0 &&
        kids.every((k) => isMedia(k.tagName.toLowerCase()) || k.tagName.toLowerCase() === 'br')

      let nextFg = inheritedFg

      if (urlBg || mediaOnly) {
        // Keep illustrations; still force readable text for sibling captions under the wrap.
        applyText(el, inheritedFg)
        for (const child of kids) {
          if (!isMedia(child.tagName.toLowerCase()) && child.tagName.toLowerCase() !== 'br') {
            walk(child, depth + 1, nextFg)
          }
        }
        return
      }

      const surfaceBg = cs.backgroundColor
      if (!isTransparentCssColor(surfaceBg)) {
        if (isDarkDecorativeBackground(surfaceBg)) {
          // Black/dark caption bars: keep fill, switch to light glyphs.
          const light = contrastTextForBackground(surfaceBg, fg, bg) || '#f4f1ea'
          nextFg = light
          applyText(el, light)
        } else {
          // Light / tinted publisher washes → theme page color + theme text.
          el.style.setProperty('background-color', bg, 'important')
          nextFg = fg
          applyText(el, fg)
        }
      } else {
        applyText(el, inheritedFg)
      }

      for (const child of kids) walk(child, depth + 1, nextFg)
    }

    for (const child of Array.from(body.children)) {
      if (child instanceof HTMLElement) walk(child, 0, fg)
    }
  }

  /** Match iframe / epub-view chrome to theme — gaps around columns show host bg. */
  private paintHostSurfaces(doc: Document, bg: string) {
    try {
      const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
      if (iframe) {
        iframe.style.background = bg
        iframe.style.backgroundColor = bg
        let el: HTMLElement | null = iframe.parentElement
        for (let i = 0; i < 4 && el; i++) {
          el.style.background = bg
          el.style.backgroundColor = bg
          if (el.classList.contains('epub-container') || el.classList.contains('epub-reader')) break
          el = el.parentElement
        }
      }
    } catch {
      /* */
    }
    if (this.container) {
      this.container.style.background = bg
      this.container.style.backgroundColor = bg
    }
  }

  private scheduleThemeRepaint(doc: Document) {
    if (!this.settings) return
    const settings = this.settings
    // Late publisher CSS + chapter scripts often paint after first frame on mobile WebKit.
    // First tick: full wash. Later ticks: soft reassert only (avoids PC height thrash).
    for (const [i, ms] of [0, 160, 500, 1400].entries()) {
      const timer = window.setTimeout(() => {
        this.themeRepaintTimers = this.themeRepaintTimers.filter((t) => t !== timer)
        if (!this.settings || this.settings !== settings) return
        if (!doc.defaultView || doc.defaultView.closed) return
        this.applyThemeColorsToDocument(doc, settings, i === 0)
      }, ms)
      this.themeRepaintTimers.push(timer)
    }
  }

  /**
   * After page turn: ensure theme stylesheet is last and html/body colors stick.
   * Full subtree rewrite only when the theme style is missing (new iframe).
   */
  private reassertThemeColors(settings: ReaderSettings) {
    if (!this.rendition) return
    const { bg, fg, theme } = this.themeColors(settings)
    const fp = `${theme}\0${bg}\0${fg}`
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      ).getContents?.()
      contents?.forEach((c) => {
        const doc = c.document
        if (!doc) return
        const styleEl = doc.getElementById('qingyue-theme') as HTMLStyleElement | null
        if (!styleEl || doc.documentElement.dataset.qyTheme !== fp) {
          this.applyThemeColorsToDocument(doc, settings, true)
          return
        }
        this.themeApplyDepth += 1
        try {
          this.pinThemeStyleLast(doc, styleEl)
          const root = doc.documentElement
          root.style.setProperty('background-color', bg, 'important')
          root.style.setProperty('background-image', 'none', 'important')
          root.style.setProperty('color', fg, 'important')
          const body = doc.body
          if (body) {
            body.style.setProperty('background-color', bg, 'important')
            body.style.setProperty('background-image', 'none', 'important')
            body.style.setProperty('color', fg, 'important')
            this.paintPublisherWashes(doc, bg, fg)
          }
          this.paintHostSurfaces(doc, bg)
        } finally {
          this.themeApplyDepth -= 1
          this.themeQuietUntil = performance.now() + 220
        }
      })
    } catch {
      /* */
    }
  }

  private applyThemeColorsToAllContents(settings: ReaderSettings) {
    if (!this.rendition) return
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      ).getContents?.()
      contents?.forEach((c) => {
        if (c.document) this.applyThemeColorsToDocument(c.document, settings, true)
      })
    } catch {
      /* */
    }
    const { bg } = this.themeColors(settings)
    if (this.container) {
      this.container.style.background = bg
      this.container.style.backgroundColor = bg
      this.container.querySelectorAll('.epub-view, .epub-container').forEach((node) => {
        if (node instanceof HTMLElement) {
          node.style.background = bg
          node.style.backgroundColor = bg
        }
      })
    }
  }

  private applyThemeToRendition(settings: ReaderSettings) {
    if (!this.rendition) return
    this.clearInjectedThemeStyles()
    const { bg, fg } = this.themeColors(settings)
    const typeface = {
      'font-size': `${settings.fontSize}px !important`,
      'line-height': `${settings.lineHeight} !important`,
      'font-family': `${settings.fontFamily} !important`,
    }
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
    // Paginated: never clamp html/body width or overflow-x — epub.js expand() builds a
    // wide multi-column strip and measures scrollWidth. Forcing width/max-width:100% or
    // overflow-x:hidden fights expand (height thrash / blank first page until turn).
    const htmlRules: Record<string, string> = {
      'box-sizing': 'border-box !important',
      'background-color': `${bg} !important`,
      'background-image': 'none !important',
      color: `${fg} !important`,
    }
    const bodyRules: Record<string, string> = {
      'background-color': `${bg} !important`,
      'background-image': 'none !important',
      color: `${fg} !important`,
      ...typeface,
      margin: '0 !important',
      cursor: 'default !important',
      'caret-color': 'transparent !important',
      'user-select': 'text !important',
      '-webkit-user-select': 'text !important',
      'box-sizing': 'border-box !important',
      'word-wrap': 'break-word !important',
      'overflow-wrap': 'anywhere !important',
    }
    if (settings.pageTurn === 'scroll') {
      htmlRules['overflow-x'] = 'hidden !important'
      htmlRules['max-width'] = '100% !important'
      htmlRules.width = '100% !important'
      bodyRules['overflow-x'] = 'hidden !important'
      bodyRules['max-width'] = '100% !important'
      bodyRules.width = '100% !important'
      bodyRules.padding = `${settings.marginY}px ${settings.marginX}px !important`
    } else {
      bodyRules['padding-top'] = '0 !important'
      bodyRules['padding-bottom'] = '0 !important'
      bodyRules['padding-left'] = '0 !important'
      bodyRules['padding-right'] = '0 !important'
    }
    this.rendition.themes.default({
      html: htmlRules,
      '*, *::before, *::after': {
        'box-sizing': 'border-box !important',
      },
      body: bodyRules,
      'body p, body div, body li, body td, body th, body blockquote, body section, body article, body figure, body figcaption, body caption, body cite':
        {
          ...typeface,
          color: `${fg} !important`,
        },
      'body p[class], body div[class], body li[class], body span[class], body td[class], body th[class], body blockquote[class], body section[class], body article[class], body figcaption[class], body caption[class], body [class*="caption"], body [class*="Caption"]':
        {
          color: `${fg} !important`,
          opacity: '1 !important',
        },
      'img, picture, video, canvas': {
        'max-width': '100vw !important',
        'max-height': '92vh !important',
        width: 'auto !important',
        height: 'auto !important',
        'object-fit': 'contain !important',
        'box-sizing': 'border-box !important',
        'background-color': 'transparent !important',
        'break-inside': 'avoid !important',
        '-webkit-column-break-inside': 'avoid !important',
      },
      svg: {
        'max-width': '100vw !important',
        'max-height': '92vh !important',
        'box-sizing': 'border-box !important',
        'background-color': 'transparent !important',
        'break-inside': 'avoid !important',
        '-webkit-column-break-inside': 'avoid !important',
      },
      'div:has(> img), div:has(> svg), div:has(> picture), p:has(> img), p:has(> svg), figure': {
        'background-color': 'transparent !important',
        'max-width': '100vw !important',
        'box-sizing': 'border-box !important',
      },
      'figcaption, caption, [class*="caption"], [class*="image-title"], [class*="img-title"]': {
        opacity: '1 !important',
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
      'body p': {
        ...typeface,
        color: `${fg} !important`,
        'margin-top': '0 !important',
        'margin-bottom': `${settings.paragraphGap}em !important`,
        'text-indent': `${settings.indent}em !important`,
        cursor: 'text !important',
        'caret-color': 'transparent !important',
        'user-select': 'text !important',
        '-webkit-user-select': 'text !important',
      },
      'body div, body li, body blockquote': {
        'margin-bottom': `${Math.max(0, settings.paragraphGap * 0.5)}em !important`,
      },
      'h1, h2, h3, h4, h5, h6': {
        ...titleReset,
        color: `${fg} !important`,
        'font-family': `${settings.fontFamily} !important`,
        'margin-top': '1.1em !important',
        'margin-bottom': '0.75em !important',
        'line-height': '1.35 !important',
      },
      h1: { 'font-size': '1.45em !important', ...titleReset },
      h2: { 'font-size': '1.28em !important', ...titleReset },
      h3: { 'font-size': '1.15em !important', ...titleReset },
      'p.title, p.titlepage, p.chapter, p.chapter-title, p.ctitle, p.center, .title, .chapter-title, .chapterTitle, .kindle-cn-title, .contents-title, [class*="title"], [class*="Title"], [class*="chapter-title"], [class*="Chapter"], [class*="CENTER"], [class*="center"]':
        {
          ...titleReset,
          color: `${fg} !important`,
          'margin-bottom': `${Math.max(0.6, settings.paragraphGap)}em !important`,
        },
      'p[align="center"], p[align="CENTER"], p[align="right"], p[align="RIGHT"], div[align="center"], div[align="right"], h1[align], h2[align], h3[align]':
        {
          ...titleReset,
        },
      a: {
        cursor: 'pointer !important',
        color: `${fg} !important`,
      },
    })
    this.applyThemeColorsToAllContents(settings)
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

  /**
   * Fit media into the page/column box on phone/tablet/PC.
   * Paginated CSS columns: max-width:100% resolves against the *expanded* multicol
   * strip, so wide bitmaps spill into the next column ("第二页"). Cap with the
   * iframe/page pixel width (≈ 100vw inside the chapter iframe) instead.
   * Never strip width/height attributes on SVG (1×1 collapse).
   */
  private containOverflowMedia(doc: Document) {
    const maxH = this.mediaMaxHeightPx(doc)
    const maxW = this.mediaMaxWidthPx(doc)
    const maxHCss = `${maxH}px`
    const maxWCss = `${maxW}px`

    const fitBitmap = (node: HTMLElement) => {
      node.style.setProperty('max-width', maxWCss, 'important')
      node.style.setProperty('max-height', maxHCss, 'important')
      node.style.setProperty('width', 'auto', 'important')
      node.style.setProperty('height', 'auto', 'important')
      node.style.setProperty('object-fit', 'contain', 'important')
      node.style.setProperty('box-sizing', 'border-box', 'important')
      node.style.setProperty('break-inside', 'avoid', 'important')
      node.style.setProperty('page-break-inside', 'avoid', 'important')
      node.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')
    }

    doc.querySelectorAll('img, video, canvas').forEach((node) => {
      if (node instanceof HTMLElement) fitBitmap(node)
    })

    doc.querySelectorAll('picture').forEach((node) => {
      if (!(node instanceof HTMLElement)) return
      node.style.setProperty('max-width', maxWCss, 'important')
      node.style.setProperty('max-height', maxHCss, 'important')
      node.style.setProperty('box-sizing', 'border-box', 'important')
      node.style.setProperty('break-inside', 'avoid', 'important')
      node.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')
    })

    doc.querySelectorAll('svg').forEach((node) => {
      if (!(node instanceof SVGElement)) return
      node.style.setProperty('max-width', maxWCss, 'important')
      node.style.setProperty('max-height', maxHCss, 'important')
      node.style.setProperty('box-sizing', 'border-box', 'important')
      node.style.setProperty('break-inside', 'avoid', 'important')
      node.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')
    })

    // Wrappers with fixed publisher widths still push the column strip wider.
    doc.querySelectorAll('div, p, figure, span, center').forEach((node) => {
      if (!(node instanceof HTMLElement)) return
      if (!node.querySelector(':scope > img, :scope > picture, :scope > svg, :scope > video')) return
      node.style.setProperty('max-width', maxWCss, 'important')
      node.style.setProperty('box-sizing', 'border-box', 'important')
      node.style.setProperty('overflow-x', 'hidden', 'important')
    })

    // Do not force iframe/body width in paginated mode — that collapses epub.js multi-page expand.
    if (this.pageTurn !== 'scroll') return

    const html = doc.documentElement
    const body = doc.body
    html?.style.setProperty('overflow-x', 'hidden', 'important')
    html?.style.setProperty('box-sizing', 'border-box', 'important')
    body?.style.setProperty('overflow-x', 'hidden', 'important')
    body?.style.setProperty('max-width', '100%', 'important')
    body?.style.setProperty('width', '100%', 'important')
    body?.style.setProperty('box-sizing', 'border-box', 'important')
    body?.style.setProperty('margin', '0', 'important')

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

  /** Single-page / column content width in px (not the expanded multicol strip). */
  private mediaMaxWidthPx(doc: Document): number {
    const win = doc.defaultView
    let w = 0
    if (win && win.innerWidth > 0) w = win.innerWidth
    if (!w && this.container) {
      const scroller = this.container.querySelector('.epub-container') as HTMLElement | null
      w = scroller?.clientWidth || this.container.clientWidth
    }
    if (!w) w = typeof window !== 'undefined' ? window.innerWidth : 360
    // Dual spread: two pages share the view — each column is about half.
    if (this.settings && this.isDualSpread(this.settings)) {
      w = Math.max(120, Math.floor((w - 40) / 2))
    }
    return Math.max(64, Math.floor(w * 0.96))
  }

  /** Page box height for media fit (iframe viewport ≈ one column / screen). */
  private mediaMaxHeightPx(doc: Document): number {
    const win = doc.defaultView
    let h = 0
    if (win && win.innerHeight > 0) h = win.innerHeight
    if (!h && this.container) h = this.container.clientHeight
    if (!h) h = typeof window !== 'undefined' ? window.innerHeight : 640
    // Leave headroom for captions sharing the same column on small phones.
    const ratio = h < 700 ? 0.86 : 0.92
    return Math.max(96, Math.floor(h * ratio))
  }

  /** Re-fit images after stage resize / late decode (all open chapter docs). */
  private containOverflowMediaAll() {
    if (!this.rendition) return
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      ).getContents?.()
      contents?.forEach((c) => {
        if (c.document) this.containOverflowMedia(c.document)
      })
    } catch {
      /* */
    }
  }

  private getProgressFromLoc(loc: EpubRelocatedLoc): ReadingProgress {
    const percent =
      typeof loc.percentage === 'number'
        ? loc.percentage * 100
        : typeof loc.start?.percentage === 'number'
          ? loc.start.percentage * 100
          : (loc.start.index / Math.max(1, this.spineLength - 1)) * 100

    let page: number | undefined
    let pageCount: number | undefined
    let pageMode: ReadingProgress['pageMode']

    const locations = (
      this.book as Book & {
        locations?: {
          length?: () => number
          locationFromCfi?: (cfi: string) => number
        }
      }
    )?.locations

    if (this.locationsReady && locations?.length && locations.locationFromCfi && loc.start.cfi) {
      const total = locations.length()
      if (total > 0) {
        const idx = locations.locationFromCfi(loc.start.cfi)
        const n = typeof idx === 'number' && Number.isFinite(idx) ? idx : 0
        page = Math.min(total, Math.max(1, Math.floor(n) + 1))
        pageCount = total
        pageMode = 'estimate'
      }
    }

    if (page == null && loc.start.displayed && loc.start.displayed.total > 0) {
      page = Math.max(1, loc.start.displayed.page || 1)
      pageCount = loc.start.displayed.total
      pageMode = 'chapter'
    }

    if (page == null) {
      page = (loc.start.index ?? 0) + 1
      pageCount = Math.max(1, this.spineLength)
      pageMode = 'estimate'
    }

    return {
      locator: {
        type: 'epub' as const,
        cfi: loc.start.cfi,
        spineIndex: loc.start.index,
      },
      percent,
      page,
      pageCount,
      pageMode,
    }
  }
}

type EpubRelocatedLoc = {
  percentage?: number
  start: {
    cfi: string
    index: number
    percentage?: number
    displayed?: { page: number; total: number }
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
