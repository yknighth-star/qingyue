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
 * Debounces mouseup + selectionchange into onEmit.
 */
export function createHostSelectionBridge(opts: {
  getRoot: () => HTMLElement | null
  capture: () => SelectionCapture | null
  onEmit: (ev: SelectionCaptureEvent) => void
}) {
  let debounce: number | null = null
  let selectingPointer = false

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

  function bind(el: HTMLElement) {
    el.addEventListener('mousedown', () => {
      selectingPointer = true
    })
    el.addEventListener('mouseup', (e) => {
      selectingPointer = false
      schedule(e.clientX, e.clientY)
    })
    document.addEventListener('selectionchange', onDocSelectionChange)
  }

  function destroy() {
    if (debounce) window.clearTimeout(debounce)
    debounce = null
    document.removeEventListener('selectionchange', onDocSelectionChange)
  }

  return { bind, destroy, schedule }
}
