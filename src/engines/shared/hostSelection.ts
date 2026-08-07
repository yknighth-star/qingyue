import type { Locator } from '@/types'
import { buildSelectionEvent } from '@/utils/selectionToolbar'
import type { SelectionCaptureEvent } from '../types'

export type SelectionCapture = {
  text: string
  locator: Locator
  rect?: SelectionCaptureEvent['rect']
}

/**
 * Host-document selection bridge for TXT / PDF (not EPUB iframes).
 * Debounces pointer/mouse end + selectionchange into onEmit (mobile long-press included).
 */
export function createHostSelectionBridge(opts: {
  getRoot: () => HTMLElement | null
  capture: () => SelectionCapture | null
  onEmit: (ev: SelectionCaptureEvent) => void
}) {
  let debounce: number | null = null
  let selectingPointer = false
  let boundEl: HTMLElement | null = null

  function schedule(fallbackX?: number, fallbackY?: number) {
    if (debounce) window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      debounce = null
      const cap = opts.capture()
      if (!cap?.text) return
      const ev = buildSelectionEvent(cap.text, cap.locator, cap.rect ?? null, fallbackX, fallbackY)
      if (ev) opts.onEmit(ev)
    }, 50)
  }

  const onDocSelectionChange = () => {
    const root = opts.getRoot()
    if (!root || selectingPointer) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    if (!root.contains(sel.anchorNode)) return
    schedule()
  }

  const onPointerDown = () => {
    selectingPointer = true
  }

  const onPointerUp = (e: PointerEvent) => {
    selectingPointer = false
    schedule(e.clientX, e.clientY)
  }

  const onPointerCancel = () => {
    selectingPointer = false
  }

  /** Desktop browsers that still emit mouse without pointer (rare) */
  const onMouseUp = (e: MouseEvent) => {
    selectingPointer = false
    schedule(e.clientX, e.clientY)
  }

  function bind(el: HTMLElement) {
    boundEl = el
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onDocSelectionChange)
  }

  function destroy() {
    if (debounce) window.clearTimeout(debounce)
    debounce = null
    if (boundEl) {
      boundEl.removeEventListener('pointerdown', onPointerDown)
      boundEl.removeEventListener('pointerup', onPointerUp)
      boundEl.removeEventListener('pointercancel', onPointerCancel)
      boundEl.removeEventListener('mouseup', onMouseUp)
      boundEl = null
    }
    document.removeEventListener('selectionchange', onDocSelectionChange)
  }

  return { bind, destroy, schedule }
}
