import type { AnnotationRecord, Locator, ReaderSettings, SearchHit, TocItem } from '@/types'

export interface ContentTapEvent {
  clientX: number
  clientY: number
  /** true when user clicked an <a> inside content */
  isLink: boolean
  /** true when a non-empty text selection exists at tap time */
  hasSelection?: boolean
}

export type ContentGesturePhase = 'start' | 'move' | 'end' | 'cancel' | 'longpress'


/** Pointer gesture inside content (including EPUB iframe), coords in parent viewport. */
export interface ContentGestureEvent {
  phase: ContentGesturePhase
  pointerId: number
  clientX: number
  clientY: number
  pointerType: string
}

export interface SelectionCaptureEvent {
  text: string
  locator: Locator
  clientX: number
  clientY: number
  /** Selection geometry in viewport coordinates */
  rect: { top: number; left: number; bottom: number; right: number }
}

/** Declared capabilities — UI can hide unsupported actions. */
export interface EngineCapabilities {
  search: boolean
  /** Bookmarks + annotation list / applyAnnotations */
  annotations: boolean
  /** Paint selection-based text highlights in the content view */
  textHighlights: boolean
  selection: boolean
  percentJump: boolean
  /** Offline OCR for scanned PDFs (Tesseract). */
  offlineOcr: boolean
}

export const FULL_ENGINE_CAPABILITIES: EngineCapabilities = {
  search: true,
  annotations: true,
  textHighlights: true,
  selection: true,
  percentJump: true,
  offlineOcr: false,
}

export const PDF_ENGINE_CAPABILITIES: EngineCapabilities = {
  ...FULL_ENGINE_CAPABILITIES,
  offlineOcr: true,
}

/** How page / pageCount were derived for chrome display. */
export type PageCountMode = 'exact' | 'estimate' | 'chapter'

/** Reading position reported by engines to the shell. */
export interface ReadingProgress {
  locator: Locator
  percent: number
  /** 1-based current page when known */
  page?: number
  /** Total pages when known */
  pageCount?: number
  /** exact = PDF; estimate = EPUB locations / TXT; chapter = section-local only */
  pageMode?: PageCountMode
}

export interface SearchOptions {
  /** Run offline OCR on sparse/empty pages before matching. */
  ocr?: boolean
  onOcrProgress?: (p: { page: number; total: number }) => void
  /** Called with cumulative hits so the UI can show results before the full scan finishes. */
  onHits?: (hits: SearchHit[]) => void
  /** Optional page progress for non-OCR scans. */
  onSearchProgress?: (p: { page: number; total: number }) => void
  signal?: AbortSignal
}

export interface OpenBookOptions {
  /** Restore reading position in the first display() — avoids open-at-start then goTo (double load). */
  initialLocator?: Locator
}

export interface ReaderEngine {
  readonly capabilities: EngineCapabilities
  open(
    blob: Blob,
    settings: ReaderSettings,
    container: HTMLElement,
    opts?: OpenBookOptions,
  ): Promise<void>
  destroy(): void
  applySettings(settings: ReaderSettings): void
  /** Recompute layout after the reading stage size changes (e.g. chrome show/hide). */
  resizeToContainer?(): void
  /** TXT auto-scroll: pause / resume without clearing speed setting. */
  toggleAutoScrollPause?(): 'paused' | 'running' | null
  isAutoScrollPaused?(): boolean
  getToc(): TocItem[]
  getProgress(): ReadingProgress
  goTo(locator: Locator): Promise<void> | void
  /** Jump roughly by reading progress 0–100 */
  goToPercent(percent: number): Promise<void> | void
  next(): Promise<void> | void
  prev(): Promise<void> | void
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>
  /** True when embedded text looks too sparse (likely a scan). */
  probeNeedsOcr?(): Promise<boolean>
  /** Temporarily highlight search matches in the current view; pass null/'' to clear. */
  highlightSearch(query: string | null): void
  getSelectableText(): string
  onProgress(cb: (p: ReadingProgress) => void): void
  /** Wheel over content (including EPUB iframe). deltaY > 0 means scroll down. */
  onWheel(cb: (deltaY: number) => void): void
  /** Click/tap inside content area (including EPUB iframe). */
  onContentTap(cb: (e: ContentTapEvent) => void): void
  /**
   * Pointer swipe/drag inside content (including EPUB iframe).
   * Engines without iframes may no-op; stage handlers cover TXT/PDF.
   */
  onContentGesture(cb: (e: ContentGestureEvent) => void): void
  /** Text selection ready (including EPUB iframe mouseup). */
  onSelection(cb: (e: SelectionCaptureEvent | null) => void): void
  /**
   * 划线模式：关闭翻页手势抢占，放开原生拖选。
   * 由阅读器在长按进入 / 关闭工具条时调用。
   */
  setSelectMode?(active: boolean): void
  /** Clear native text selection in host / iframe documents. */
  clearNativeSelection?(): void
  /**
   * 划线模式自建拖选（对齐华为阅读：拖选 + 两端手柄），坐标为父页面视口。
   */
  markDrag?(
    phase: 'start' | 'move' | 'end',
    clientX: number,
    clientY: number,
  ): import('@/utils/markSelect').MarkHandleRects | null
  markHandle?(
    phase: 'start' | 'move' | 'end',
    which: 'start' | 'end',
    clientX: number,
    clientY: number,
  ): import('@/utils/markSelect').MarkHandleRects | null
  getMarkHandleRects?(): import('@/utils/markSelect').MarkHandleRects | null
  applyAnnotations(annots: AnnotationRecord[]): void
  captureSelection(): { text: string; locator: Locator; rect?: SelectionCaptureEvent['rect'] } | null
}
