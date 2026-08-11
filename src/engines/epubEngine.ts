import ePub, { type Book, type NavItem, type Rendition } from 'epubjs'
import type { AnnotationRecord, Locator, PageTurnMode, ReaderSettings, SearchHit, TocItem } from '@/types'
import { applyThemeVars, effectiveTheme, DUAL_COLUMN_MIN_WIDTH, THEME_VARS } from '@/utils/format'
import {
  LIGHT_ON_DARK_FG,
  applyShortLabelContrast,
  collectSvgTitleBands,
  isDarkDecorativeBackground,
  isDarkSurfaceCss,
  isFigureTitleChrome,
  isHtmlElement,
  isSvgGeometryElement,
  isSvgSvgElement,
  isTransparentCssColor,
  resolveSurfaceBackgroundCss,
  resolveSvgTextFill,
  shouldLightenSvgGlyphShape,
  urlBackgroundLikelyTitleBar,
} from '@/utils/colorContrast'
import { buildSelectionEvent, mapPointToParentViewport, mapRectToParentViewport, selectionRectFromSel } from '@/utils/selectionToolbar'
import { clearSearchMarks, highlightSearchInRoot } from '@/utils/domHighlight'
import { revokeFontUrlCache, remapBookCssFonts, rewriteEpubFontUrls } from './epubFontUrls'
import {
  FULL_ENGINE_CAPABILITIES,
  type ContentGestureEvent,
  type ContentTapEvent,
  type OpenBookOptions,
  type ReadingProgress,
  type ReaderEngine,
  type SearchOptions,
  type SelectionCaptureEvent,
} from './types'
import { createCurlGate, createMarkSurface, createSearchHighlightState } from './shared'
import { injectCaretSuppression } from '@/utils/suppressCaret'
import type { MarkHandleRects } from '@/utils/markSelect'
import { searchEpubBook } from './epubSearch'
import { detectEpubBookProfile, type EpubBookProfile } from './epubBookProfile'
import {
  bindMediaLoadRefit,
  fitMediaInDocument,
  paginatedMediaCss,
  paginatedMediaThemeRules,
  resolveColumnPageBox,
  type ColumnPageBox,
} from '@/utils/epubMediaFit'

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
  private locationsTimer: number | null = null
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
  private mediaRefitTimer: number | null = null
  private mediaRefitDisposers: Array<() => void> = []
  private lastSize = { w: 0, h: 0 }
  /** True while page-turn animation runs — ignore ResizeObserver (prevents shake). */
  private layoutLocked = false
  private overflowLocked = false
  /** Guard: media-load reflow must not re-enter applyResize recursively. */
  private mediaReflowing = false
  private mediaQuietUntil = 0
  private bookProfile: EpubBookProfile | null = null
  /** Coalesced EPUB turns: +next / -prev. Rapid PC wheel must not drop. */
  private turnPending = 0
  private turnPump: Promise<void> | null = null
  private readonly mark = createMarkSurface({
    getDocs: () => {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      )?.getContents?.()
      if (!contents?.length) return []
      return contents.map((c) => c.document).filter(Boolean)
    },
  })

  async open(
    blob: Blob,
    settings: ReaderSettings,
    container: HTMLElement,
    opts?: OpenBookOptions,
  ) {
    this.destroy()
    this.container = container
    this.settings = { ...settings }
    this.pageTurn = settings.pageTurn
    container.innerHTML = ''
    container.className = 'epub-reader'
    container.dataset.turn = settings.pageTurn
    applyThemeVars(container, effectiveTheme(settings), settings)

    // Full blobUrl replacements are required for srcdoc images + CSS columns + reliable next/prev.
    // Do not reintroduce CSS-only / replacements:none patches — they break pagination.
    const data = await blob.arrayBuffer()
    this.book = ePub(data, { replacements: 'blobUrl' })
    await this.book.opened
    await this.book.ready
    this.spineLength = (this.book.spine as { length?: number }).length || 1
    const nav = this.book.navigation
    this.toc = flattenNav(nav?.toc || [])
    const resources = (this.book as Book & { resources?: { urls?: string[]; cssUrls?: string[] } })
      .resources
    this.bookProfile = detectEpubBookProfile(this.spineLength, blob.size, resources)
    // Text novels never need publisher scripts; scripts fight pagination on huge spines.
    const allowScripts = !this.bookProfile.textNovel

    this.rendition = this.book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: settings.pageTurn === 'scroll' ? 'scrolled-doc' : 'paginated',
      overflow: settings.pageTurn === 'scroll' ? 'scroll' : 'hidden',
      spread:
        settings.dualColumn &&
        settings.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
          ? 'always'
          : 'none',
      gap:
        settings.dualColumn &&
        settings.pageTurn !== 'scroll' &&
        window.innerWidth >= DUAL_COLUMN_MIN_WIDTH
          ? 40
          : 0,
      allowScriptedContent: allowScripts,
    })
    this.applyThemeToRendition(settings)

    const hooks = this.rendition as unknown as {
      hooks: { content: { register: (fn: (contents: ContentsDoc) => void) => void } }
    }
    hooks.hooks.content.register((contents) => this.bindContentEvents(contents))

    const initial = opts?.initialLocator
    const displayTarget =
      initial && initial.type === 'epub'
        ? initial.cfi || initial.href || initial.spineIndex
        : undefined
    await this.rendition.display(displayTarget)

    // Fonts can wait until after first page is interactive (rewriteDocFonts also runs on mount).
    void remapBookCssFonts(this.book, this.fontUrlCache).catch((err) => {
      console.warn('epub css font remap failed', err)
    })

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
    if (!this.bookProfile?.textNovel) this.containOverflowMediaAll()
    this.observeResize(container)

    this.curl.onBusyChange((b) => {
      this.layoutLocked = b
    })

    this.rendition.on('relocated', (...args: unknown[]) => {
      const loc = args[0] as EpubRelocatedLoc
      this.spineIndex = loc.start?.index ?? 0
      this.progressCb?.(this.getProgressFromLoc(loc))
      this.lockEpubHorizontalOverflow()
      this.snapPaginatedScroll()
      // Soft theme only — full wash/media fit are deferred (PC illustrated books thrash otherwise).
      // Text novels: skip wash/media entirely on relocate — spine hops must stay cheap.
      if (this.bookProfile?.textNovel) {
        if (this.settings) this.reassertThemeColors(this.settings, { light: true, skipWashes: true })
        return
      }
      if (this.settings) this.reassertThemeColors(this.settings, { light: true })
      this.schedulePostRelocateWork()
    })

    this.scheduleLocationsGenerate()
  }

  /**
   * Whole-book locations.generate walks every spine item — banned on large CN novels
   * (e.g. 诡秘之主). Progress falls back to spine index / chapter displayed pages.
   */
  private scheduleLocationsGenerate() {
    this.locationsReady = false
    const gen = ++this.locationsGen
    if (this.locationsTimer) {
      window.clearTimeout(this.locationsTimer)
      this.locationsTimer = null
    }
    if (this.bookProfile?.largeSpine) return

    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8
    const delayMs = w >= 1100 ? 3500 : cores <= 4 ? 2200 : 1200
    const charsPerLoc = w >= 1100 ? 2000 : cores <= 4 ? 2400 : 1600
    this.locationsTimer = window.setTimeout(() => {
      this.locationsTimer = null
      if (gen !== this.locationsGen || !this.book) return
      const start = () => {
        if (gen !== this.locationsGen || !this.book) return
        const locations = (
          this.book as Book & { locations?: { generate?: (chars: number) => Promise<unknown> } }
        ).locations
        void locations
          ?.generate?.(charsPerLoc)
          ?.then(() => {
            if (gen !== this.locationsGen) return
            this.locationsReady = true
            this.progressCb?.(this.getProgress())
          })
          .catch(() => {
            /* optional */
          })
      }
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => start(), { timeout: 2500 })
      } else {
        start()
      }
    }, delayMs)
  }

  /** Debounced media fit after page turn — never block the turn gesture. */
  private schedulePostRelocateWork() {
    if (this.bookProfile?.textNovel) return
    if (this.mediaRefitTimer) window.clearTimeout(this.mediaRefitTimer)
    this.mediaRefitTimer = window.setTimeout(() => {
      this.mediaRefitTimer = null
      if (this.layoutLocked) return
      this.containOverflowMediaAll()
    }, 120)
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
    this.containOverflowMediaAll()

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

  /** Late-loading images change column geometry — refit then force a soft reflow. */
  private scheduleMediaReflow() {
    if (this.pageTurn === 'scroll') {
      this.containOverflowMediaAll()
      return
    }
    if (this.mediaReflowing || this.layoutLocked) return
    if (performance.now() < this.mediaQuietUntil) {
      this.containOverflowMediaAll()
      return
    }
    if (this.mediaRefitTimer) window.clearTimeout(this.mediaRefitTimer)
    this.mediaRefitTimer = window.setTimeout(() => {
      this.mediaRefitTimer = null
      if (this.mediaReflowing || this.layoutLocked) return
      this.mediaReflowing = true
      this.mediaQuietUntil = performance.now() + 450
      try {
        // Fit first (shrink figures), then resize so epub.js rebuilds columns
        // around the new sizes — otherwise the old wide-column geometry sticks.
        this.containOverflowMediaAll()
        this.applyResize(true)
        window.setTimeout(() => {
          this.containOverflowMediaAll()
          this.snapPaginatedScroll()
        }, 80)
      } finally {
        this.mediaReflowing = false
      }
    }, 100)
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

    const textNovel = Boolean(this.bookProfile?.textNovel)
    this.normalizeChapterTitles(doc)
    if (this.settings) {
      // Defer contrast wash so first paint / first turn stay responsive on PC.
      // Text novels: stylesheet + html/body only — no publisher wash walks / repaint storms.
      this.applyThemeColorsToDocument(doc, this.settings, true, {
        deferWashes: true,
        skipWashes: textNovel,
      })
      this.applyTypographyToDocument(doc, this.settings)
      if (!textNovel) this.scheduleThemeRepaint(doc)
    }
    if (!textNovel) {
      // After theme paint so inline media caps win; re-fit when late images decode.
      this.containOverflowMedia(doc)
      const disposeRefit = bindMediaLoadRefit(doc, () => this.scheduleMediaReflow())
      this.mediaRefitDisposers.push(disposeRefit)
      // Publisher @font-face relative urls resolve to about:srcdoc and Chrome blocks them.
      void this.rewriteDocFonts(doc)
    }
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
    if (this.mediaRefitTimer) window.clearTimeout(this.mediaRefitTimer)
    this.mediaRefitTimer = null
    for (const dispose of this.mediaRefitDisposers) {
      try {
        dispose()
      } catch {
        /* */
      }
    }
    this.mediaRefitDisposers = []
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
    this.bookProfile = null
    this.turnPending = 0
    this.turnPump = null
    this.locationsReady = false
    this.locationsGen += 1
    if (this.locationsTimer) {
      window.clearTimeout(this.locationsTimer)
      this.locationsTimer = null
    }
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
    const rendition = this.rendition
    const target = locator.cfi || locator.href || locator.spineIndex
    const display = Promise.resolve(rendition.display(target)).catch((err) => {
      console.warn('epub goTo display failed', target, err)
    })
    // Never hang the shell (目录 panel / chrome) on a stuck section load.
    await Promise.race([
      display,
      new Promise<void>((r) => window.setTimeout(r, 6000)),
    ])
    await new Promise((r) => window.setTimeout(r, 50))
    this.overflowLocked = false
    this.lockEpubHorizontalOverflow()
    this.snapPaginatedScroll()
    if (this.searchHl.get()) this.applySearchHighlightToContents()
  }

  async goToPercent(percent: number) {
    if (!this.rendition) return
    const idx = Math.round((Math.min(100, Math.max(0, percent)) / 100) * Math.max(0, this.spineLength - 1))
    await this.rendition.display(idx)
  }

  async next() {
    await this.enqueueTurn(1)
  }

  async prev() {
    await this.enqueueTurn(-1)
  }

  /**
   * Coalesce rapid PC wheel / keyboard / touch turns.
   * Previous curl busy-gate silently dropped input while turnPage awaited relocate —
   * on 诡秘之主-class books that felt like "cannot turn pages".
   */
  private async enqueueTurn(delta: number) {
    this.turnPending += delta
    if (this.turnPending > 6) this.turnPending = 6
    if (this.turnPending < -6) this.turnPending = -6
    if (this.turnPump) return this.turnPump
    this.turnPump = this.drainTurns().finally(() => {
      this.turnPump = null
    })
    return this.turnPump
  }

  private async drainTurns() {
    while (this.turnPending !== 0 && this.rendition) {
      const dir: 'next' | 'prev' = this.turnPending > 0 ? 'next' : 'prev'
      this.turnPending += dir === 'next' ? -1 : 1
      await this.curl.run(this.pageTurn, this.container, dir, async () => {
        await this.turnPage(dir)
      })
    }
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
    const textNovel = Boolean(this.bookProfile?.textNovel)
    // Text novels: shorter relocate wait — chapter hops are frequent; do not pad 400ms+.
    const relocateCapMs = textNovel ? 180 : 320
    const relocated = new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        rendition.off('relocated', onRelocated)
        resolve()
      }, relocateCapMs)
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
    if (textNovel) {
      // Single rAF is enough; skip second paint wait + artifact scrub when coalescing.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      this.snapPaginatedScroll()
      return
    }
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
      if (!doc.defaultView || doc.defaultView.closed) return
      const prev = this.themeGuardTimers.get(doc)
      if (prev) window.clearTimeout(prev)
      const settings = this.settings
      // If we're in the quiet window, defer until it ends — never drop the event.
      const delay = Math.max(120, Math.ceil(this.themeQuietUntil - performance.now()) + 30)
      const timer = window.setTimeout(() => {
        this.themeGuardTimers.delete(doc)
        if (!this.settings || this.settings !== settings) return
        if (!doc.defaultView || doc.defaultView.closed) return
        if (this.themeApplyDepth > 0) return
        this.applyThemeColorsToDocument(doc, settings, force)
        this.containOverflowMedia(doc)
      }, delay)
      this.themeGuardTimers.set(doc, timer)
    }
    const observer = new MutationObserver((mutations) => {
      if (this.themeApplyDepth > 0) return
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
          if (!isHtmlElement(n)) continue
          if (n.id === 'qingyue-theme' || n.id === 'qingyue-typography' || n.id === 'qingyue-media-fit') continue
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
          // Chapter body content swapped in after first theme paint.
          if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'SVG' || tag === 'IMG') {
            scheduleReapply(false)
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
  private applyThemeColorsToDocument(
    doc: Document,
    settings: ReaderSettings,
    force = false,
    opts?: { deferWashes?: boolean; skipWashes?: boolean },
  ) {
    const { theme, bg, fg } = this.themeColors(settings)
    const flow = settings.pageTurn === 'scroll' ? 's' : 'p'
    const fp = `${theme}\0${bg}\0${fg}\0${flow}`
    const root = doc.documentElement
    const id = 'qingyue-theme'
    let styleEl = doc.getElementById(id) as HTMLStyleElement | null
    const skipWashes = Boolean(opts?.skipWashes || this.bookProfile?.textNovel)

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
          if (!skipWashes) {
            if (opts?.deferWashes) this.schedulePublisherWashes(doc, bg, fg)
            else this.paintPublisherWashes(doc, bg, fg)
          }
        }
        this.paintHostSurfaces(doc, bg)
        if (!skipWashes) this.ensureThemeDocGuard(doc)
        return
      }

      if (!styleEl) {
        styleEl = doc.createElement('style')
        styleEl.id = id
      }
      this.pinThemeStyleLast(doc, styleEl)

      const scheme = theme === 'dark' ? 'dark' : 'light'
      const lightOnDark = LIGHT_ON_DARK_FG
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
/* Caption opacity + dark-bar light text (wash also sets inline; this catches late CSS). */
${captionSel},
html body [data-qy-on-dark='1'],
html body [data-qy-on-dark='1'] * {
  opacity: 1 !important;
}
html body [data-qy-on-dark='1'],
html body [data-qy-on-dark='1'] span,
html body [data-qy-on-dark='1'] font,
html body [data-qy-on-dark='1'] a,
html body [data-qy-on-dark='1'] em,
html body [data-qy-on-dark='1'] strong,
html body [data-qy-on-dark='1'] b,
html body [data-qy-on-dark='1'] i,
html body p[data-qy-on-dark='1'],
html body p[class][data-qy-on-dark='1'],
html body p[style][data-qy-on-dark='1'],
html body div[data-qy-on-dark='1'],
html body div[class][data-qy-on-dark='1'],
html body div[style][data-qy-on-dark='1'],
html body span[data-qy-on-dark='1'],
html body span[class][data-qy-on-dark='1'],
html body h1[data-qy-on-dark='1'],
html body h2[data-qy-on-dark='1'],
html body h3[data-qy-on-dark='1'],
html body h4[data-qy-on-dark='1'],
html body h5[data-qy-on-dark='1'],
html body h6[data-qy-on-dark='1'],
html body figcaption[data-qy-on-dark='1'],
html body li[data-qy-on-dark='1'],
html body td[data-qy-on-dark='1'],
html body th[data-qy-on-dark='1'] {
  color: ${lightOnDark} !important;
  -webkit-text-fill-color: ${lightOnDark} !important;
  opacity: 1 !important;
}
/* Only mark SVG nodes explicitly — never fill:* under HTML parents (bleaches diagram labels). */
html body svg text[data-qy-on-dark='1'],
html body svg text[data-qy-on-dark='1'] tspan,
html body svg path[data-qy-on-dark='1'],
html body svg polygon[data-qy-on-dark='1'] {
  fill: ${lightOnDark} !important;
  color: ${lightOnDark} !important;
  stroke: none !important;
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
}
/* Do NOT set color/fill on svg — currentColor would turn black-bar titles dark. */
html body :has(> img):not(body),
html body :has(> picture):not(body),
html body :has(> video):not(body),
html body :has(> canvas):not(body) {
  background-color: transparent !important;
}
${settings.pageTurn === 'scroll' ? '' : paginatedMediaCss()}
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
        if (!skipWashes) {
          if (opts?.deferWashes) this.schedulePublisherWashes(doc, bg, fg)
          else this.paintPublisherWashes(doc, bg, fg)
        }
      }
      root.dataset.qyTheme = fp
      this.paintHostSurfaces(doc, bg)
      if (!skipWashes) this.ensureThemeDocGuard(doc)
    } finally {
      this.themeApplyDepth -= 1
      // Quiet long enough to absorb MutationObserver + ResizeObserver echoes.
      this.themeQuietUntil = performance.now() + 220
    }
  }

  private schedulePublisherWashes(doc: Document, bg: string, fg: string) {
    const run = () => {
      if (!doc.defaultView || doc.defaultView.closed) return
      this.paintPublisherWashes(doc, bg, fg)
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => run(), { timeout: 350 })
    } else {
      window.setTimeout(run, 50)
    }
  }

  /**
   * Override publisher color washes with theme colors, but keep dark decorative
   * surfaces (black figure-title pills) and put light text on them for contrast.
   *
   * Critical mobile case: theme forces dark fg on everything; black bars like
   * 「赈灾物品」become dark-on-black unless we detect the surface (solid /
   * gradient / bgcolor / ::before) and force light glyphs.
   */
  private paintPublisherWashes(doc: Document, bg: string, fg: string) {
    const win = doc.defaultView
    const body = doc.body
    if (!win || !body) return

    try {
      body.dataset.qyWashAt = String(Date.now())
      this.paintPublisherWashesInner(doc, bg, fg, win, body)
      body.dataset.qyWashOk = '1'
      delete body.dataset.qyWashErr
    } catch (err) {
      body.dataset.qyWashOk = '0'
      body.dataset.qyWashErr = err instanceof Error ? err.message : String(err)
      console.error('[qingyue] paintPublisherWashes failed', err)
    }
  }

  private paintPublisherWashesInner(
    doc: Document,
    bg: string,
    fg: string,
    win: Window,
    body: HTMLElement,
  ) {
    const lightOnDark = LIGHT_ON_DARK_FG
    let marked = 0
    let visited = 0
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    // Cap style walks — getComputedStyle freezes illustrated chapters (PC included).
    const maxVisit = w < 768 ? 140 : w < 1100 ? 200 : 260

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

    const hasUrlIllustration = (el: HTMLElement, cs: CSSStyleDeclaration) => {
      const inline = el.getAttribute('style') || ''
      if (/background(-image)?\s*:[^;]*url\(/i.test(inline)) return true
      const bi = cs.backgroundImage
      return !!bi && bi !== 'none' && /url\(/i.test(bi) && !/gradient\(/i.test(bi)
    }

    const applyText = (el: HTMLElement, color: string, onDark: boolean) => {
      el.style.setProperty('color', color, 'important')
      el.style.setProperty('-webkit-text-fill-color', color, 'important')
      el.style.setProperty('opacity', '1', 'important')
      if (onDark) {
        el.dataset.qyOnDark = '1'
        marked++
      } else delete el.dataset.qyOnDark
    }

    /**
     * Background wash only. Short-label glyph colors are decided once by
     * applyShortLabelContrast (no titleLike / force / reconcile fight).
     * underDark propagates only from own solid dark fill or full-bleed url bar.
     */
    const walk = (el: HTMLElement, depth: number, underDark: boolean) => {
      if (depth > 10) return
      if (++visited > maxVisit) return
      const tag = el.tagName.toLowerCase()
      if (isMedia(tag)) return
      if (el.id === 'qingyue-theme' || el.id === 'qingyue-typography' || el.id === 'qingyue-media-fit') return

      let cs: CSSStyleDeclaration
      try {
        cs = win.getComputedStyle(el)
      } catch {
        return
      }

      const kids = Array.from(el.children).filter((n) => isHtmlElement(n)) as HTMLElement[]
      const urlIllust = hasUrlIllustration(el, cs)
      const rect = el.getBoundingClientRect()
      const surface = resolveSurfaceBackgroundCss(el, cs, win, { ignorePseudos: true })
      const darkSurface = isDarkSurfaceCss(surface)
      const urlBar = urlIllust && urlBackgroundLikelyTitleBar(cs, rect)

      let nextDark = underDark

      if (urlIllust || (kids.length > 0 && kids.every((k) => isMedia(k.tagName.toLowerCase()) || k.tagName.toLowerCase() === 'br'))) {
        if (darkSurface || urlBar || underDark) {
          nextDark = true
          applyText(el, lightOnDark, true)
        } else {
          applyText(el, fg, false)
        }
        for (const child of kids) {
          if (!isMedia(child.tagName.toLowerCase()) && child.tagName.toLowerCase() !== 'br') {
            walk(child, depth + 1, nextDark)
          }
        }
        return
      }

      if (surface && !isTransparentCssColor(surface)) {
        if (isDarkDecorativeBackground(surface) || darkSurface) {
          nextDark = true
          applyText(el, lightOnDark, true)
          // Keep publisher dark fill.
        } else {
          el.style.setProperty('background-color', bg, 'important')
          nextDark = false
          applyText(el, fg, false)
        }
      } else if (urlBar) {
        nextDark = true
        applyText(el, lightOnDark, true)
      } else {
        applyText(el, underDark ? lightOnDark : fg, underDark)
      }

      for (const child of kids) walk(child, depth + 1, nextDark)
    }

    for (const child of Array.from(body.children)) {
      if (isHtmlElement(child)) walk(child, 0, false)
    }

    // ONE definitive short-label pass: dark capsule → white; cream → theme fg.
    const labelPass = applyShortLabelContrast(doc, fg)
    marked += labelPass.whitened

    body.dataset.qyWashMarked = String(marked)

    // SVG diagrams: title text uses fill/currentColor, not CSS color. HTML wash skips <svg>.
    this.paintSvgTextContrast(doc, lightOnDark, fg)
    this.scheduleSvgContrastRetries(doc, lightOnDark, fg)
  }

  /**
   * Fix SVG title contrast on black capsules.
   * - <text> fill=currentColor → theme fg makes dark-on-black
   * - CN diagrams often draw titles as <path> glyphs (not <text>) with the same bug
   * - Raise text paint order so a later black rect cannot cover glyphs
   * - Title-band heuristic for PC where getBBox/isPointInFill is unreliable mid-layout
   */
  private paintSvgTextContrast(doc: Document, light: string, dark: string) {
    const win = doc.defaultView
    let currentColor = dark
    try {
      if (doc.body && win) currentColor = win.getComputedStyle(doc.body).color || dark
    } catch {
      /* */
    }
    const lightFg = light || LIGHT_ON_DARK_FG

    doc.querySelectorAll('svg').forEach((svg) => {
      if (!isSvgSvgElement(svg)) return

      const titleBands = collectSvgTitleBands(svg, currentColor)

      // Paint order: later nodes win. Move titles above decorative bars.
      const texts = Array.from(svg.querySelectorAll('text'))
      for (const node of texts) {
        try {
          svg.appendChild(node)
        } catch {
          /* */
        }
      }

      svg.querySelectorAll('text').forEach((node) => {
        if (node.tagName.toLowerCase() !== 'text') return
        const textEl = node as unknown as SVGTextElement
        const fill = resolveSvgTextFill({
          textEl,
          light: lightFg,
          dark,
          currentColor,
          titleBands,
        })
        textEl.style.setProperty('fill', fill, 'important')
        textEl.style.setProperty('color', fill, 'important')
        if (fill === lightFg) textEl.setAttribute('data-qy-on-dark', '1')
        else textEl.removeAttribute('data-qy-on-dark')
        textEl.querySelectorAll('tspan').forEach((t) => {
          const tspan = t as SVGTSpanElement
          tspan.style.setProperty('fill', fill, 'important')
          tspan.style.setProperty('color', fill, 'important')
          if (fill === lightFg) tspan.setAttribute('data-qy-on-dark', '1')
          else tspan.removeAttribute('data-qy-on-dark')
        })
      })

      // Path/polygon "glyphs" on dark bars (Illustrator / Kindle CN exports).
      const glyphPaths: SVGGeometryElement[] = []
      svg.querySelectorAll('path, polygon').forEach((node) => {
        if (!isSvgGeometryElement(node)) return
        const fill = shouldLightenSvgGlyphShape({
          shape: node,
          light: lightFg,
          dark,
          currentColor,
          themeFg: dark,
          titleBands,
        })
        if (!fill) {
          node.removeAttribute('data-qy-on-dark')
          return
        }
        node.style.setProperty('fill', fill, 'important')
        node.setAttribute('data-qy-on-dark', '1')
        glyphPaths.push(node)
      })
      // Keep lightened glyphs above the black capsule.
      for (const node of glyphPaths) {
        try {
          svg.appendChild(node)
        } catch {
          /* */
        }
      }
    })
  }

  /** PC dual-column / late multicol layout: getBBox is empty on first paint — retry SVG wash. */
  private scheduleSvgContrastRetries(doc: Document, light: string, dark: string) {
    const run = () => {
      if (!doc.defaultView || doc.defaultView.closed) return
      applyShortLabelContrast(doc, dark)
      this.paintSvgTextContrast(doc, light, dark)
    }
    try {
      doc.defaultView?.requestAnimationFrame(() => {
        run()
        doc.defaultView?.requestAnimationFrame(run)
      })
    } catch {
      /* */
    }
    for (const ms of [80, 250, 700, 1600]) {
      const timer = window.setTimeout(() => {
        this.themeRepaintTimers = this.themeRepaintTimers.filter((t) => t !== timer)
        run()
      }, ms)
      this.themeRepaintTimers.push(timer)
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
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    // PC: fewer late washes — illustrated chapters already cost a lot on first paint.
    const ticks = w >= 1100 ? [0, 280] : [0, 160, 500, 1400]
    for (const [i, ms] of ticks.entries()) {
      const timer = window.setTimeout(() => {
        this.themeRepaintTimers = this.themeRepaintTimers.filter((t) => t !== timer)
        if (!this.settings || this.settings !== settings) return
        if (!doc.defaultView || doc.defaultView.closed) return
        this.applyThemeColorsToDocument(doc, settings, i === 0, {
          deferWashes: i > 0 || w >= 1100,
        })
      }, ms)
      this.themeRepaintTimers.push(timer)
    }
  }

  /**
   * After page turn: ensure theme stylesheet is last and html/body colors stick.
   * `light: true` defers publisher wash; `skipWashes` skips it entirely (text novels).
   */
  private reassertThemeColors(
    settings: ReaderSettings,
    opts?: { light?: boolean; skipWashes?: boolean },
  ) {
    if (!this.rendition) return
    const skipWashes = Boolean(opts?.skipWashes || this.bookProfile?.textNovel)
    const { bg, fg, theme } = this.themeColors(settings)
    const flow = settings.pageTurn === 'scroll' ? 's' : 'p'
    const fp = `${theme}\0${bg}\0${fg}\0${flow}`
    try {
      const contents = (
        this.rendition as unknown as { getContents?: () => ContentsDoc[] }
      ).getContents?.()
      contents?.forEach((c) => {
        const doc = c.document
        if (!doc) return
        const styleEl = doc.getElementById('qingyue-theme') as HTMLStyleElement | null
        if (!styleEl || doc.documentElement.dataset.qyTheme !== fp) {
          this.applyThemeColorsToDocument(doc, settings, true, {
            deferWashes: Boolean(opts?.light),
            skipWashes,
          })
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
            if (!skipWashes) {
              if (!opts?.light) this.paintPublisherWashes(doc, bg, fg)
              else this.schedulePublisherWashes(doc, bg, fg)
            }
          }
          this.paintHostSurfaces(doc, bg)
        } finally {
          this.themeApplyDepth -= 1
          this.themeQuietUntil = performance.now() + 160
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
      // Do NOT force position:static here — kills absolute figure titles on black pills (PC).
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
      ...(settings.pageTurn === 'scroll'
        ? {
            'img, picture, video, canvas': {
              'max-width': '100% !important',
              'background-color': 'transparent !important',
            },
            svg: {
              'max-width': '100% !important',
              'background-color': 'transparent !important',
            },
            'div:has(> img), div:has(> svg), div:has(> picture), p:has(> img), p:has(> svg)': {
              'background-color': 'transparent !important',
            },
          }
        : paginatedMediaThemeRules()),
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
      // Never flatten figure overlay captions — position:static pulls them off black pills.
      if (isFigureTitleChrome(el)) {
        el.style.setProperty('text-align', 'center', 'important')
        el.style.setProperty('text-indent', '0', 'important')
        return
      }
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
      if (isHtmlElement(node)) applyCenter(node)
    })

    // Heuristic: first meaningful block that looks like a short heading (e.g. 「把你的情绪说出来」)
    const body = doc.body
    if (!body) return
    for (const child of Array.from(body.children)) {
      if (!isHtmlElement(child)) continue
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
   * Cap media to the iframe page/column box (paginated: no cross-page splits).
   * Pixel caps come from the chapter iframe — max-width:100% fails inside epub.js multicol.
   * Never strip width/height attributes — that collapses many EPUB bitmaps.
   */
  private containOverflowMedia(doc: Document) {
    if (this.bookProfile?.textNovel) return
    const mode = this.pageTurn === 'scroll' ? 'scroll' : 'paginated'
    // Host stage page box only — never iframe vw (expand() makes vw = full strip).
    let stageW = this.lastSize.w
    let stageH = this.lastSize.h
    if ((stageW < 64 || stageH < 64) && this.container) {
      const scroller = this.container.querySelector('.epub-container') as HTMLElement | null
      stageW = scroller?.clientWidth || 0
      const cs = getComputedStyle(this.container)
      const pl = parseFloat(cs.paddingLeft) || 0
      const pr = parseFloat(cs.paddingRight) || 0
      const pt = parseFloat(cs.paddingTop) || 0
      const pb = parseFloat(cs.paddingBottom) || 0
      if (!stageW) stageW = Math.max(0, this.container.clientWidth - pl - pr)
      if (stageH < 64) stageH = Math.max(0, this.container.clientHeight - pt - pb)
    }
    if (stageW < 64) stageW = typeof window !== 'undefined' ? Math.min(window.innerWidth, 430) : 360
    if (stageH < 64) stageH = typeof window !== 'undefined' ? window.innerHeight : 640

    const dual = this.settings ? this.isDualSpread(this.settings) : false
    const box: ColumnPageBox = resolveColumnPageBox({ stageW, stageH, dual })
    fitMediaInDocument(doc, box, mode)

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
