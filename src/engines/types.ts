import type { AnnotationRecord, Locator, ReaderSettings, SearchHit, TocItem } from '@/types'

export interface ContentTapEvent {
  clientX: number
  clientY: number
  /** true when user clicked an <a> inside content */
  isLink: boolean
  /** true when a non-empty text selection exists at tap time */
  hasSelection?: boolean
}

export type ContentGesturePhase = 'start' | 'move' | 'end' | 'cancel'

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

export interface ReaderEngine {
  readonly capabilities: EngineCapabilities
  open(blob: Blob, settings: ReaderSettings, container: HTMLElement): Promise<void>
  destroy(): void
  applySettings(settings: ReaderSettings): void
  /** Recompute layout after the reading stage size changes (e.g. chrome show/hide). */
  resizeToContainer?(): void
  /** TXT auto-scroll: pause / resume without clearing speed setting. */
  toggleAutoScrollPause?(): 'paused' | 'running' | null
  isAutoScrollPaused?(): boolean
  getToc(): TocItem[]
  getProgress(): { locator: Locator; percent: number }
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
  onProgress(cb: (p: { locator: Locator; percent: number }) => void): void
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
  applyAnnotations(annots: AnnotationRecord[]): void
  captureSelection(): { text: string; locator: Locator; rect?: SelectionCaptureEvent['rect'] } | null
}
