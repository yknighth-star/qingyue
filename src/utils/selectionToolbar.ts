import type { Locator } from '@/types'
import type { SelectionCaptureEvent } from '@/engines/types'

export type SelectionRect = { top: number; left: number; bottom: number; right: number }

export function rectFromDomRect(r: DOMRect): SelectionRect {
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
}

export function selectionRectFromSel(sel: Selection | null): SelectionRect | null {
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null
  try {
    const r = sel.getRangeAt(0).getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) {
      // Fallback: use first client rect
      const rects = sel.getRangeAt(0).getClientRects()
      if (rects.length) return rectFromDomRect(rects[0])
      return null
    }
    return rectFromDomRect(r)
  } catch {
    return null
  }
}

/** Map a rect from an iframe's viewport into the top-level viewport. */
export function mapRectToParentViewport(rect: SelectionRect, iframeDoc: Document): SelectionRect {
  try {
    const frame = iframeDoc.defaultView?.frameElement as HTMLElement | null
    if (!frame) return rect
    const fr = frame.getBoundingClientRect()
    return {
      top: rect.top + fr.top,
      left: rect.left + fr.left,
      bottom: rect.bottom + fr.top,
      right: rect.right + fr.left,
    }
  } catch {
    return rect
  }
}

export function mapPointToParentViewport(
  x: number,
  y: number,
  iframeDoc: Document,
): { x: number; y: number } {
  try {
    const frame = iframeDoc.defaultView?.frameElement as HTMLElement | null
    if (!frame) return { x, y }
    const fr = frame.getBoundingClientRect()
    return { x: x + fr.left, y: y + fr.top }
  } catch {
    return { x, y }
  }
}

export function buildSelectionEvent(
  text: string,
  locator: Locator,
  rect: SelectionRect | null,
  fallbackX = 0,
  fallbackY = 0,
): SelectionCaptureEvent | null {
  const t = text.trim()
  if (!t) return null
  const r =
    rect ||
    ({
      top: fallbackY,
      left: fallbackX,
      bottom: fallbackY,
      right: fallbackX,
    } satisfies SelectionRect)
  return {
    text: t,
    locator,
    clientX: (r.left + r.right) / 2,
    clientY: r.top,
    rect: r,
  }
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Place a fixed toolbar above a viewport rect, clamped to the screen. */
export function placeToolbarAboveRect(
  rect: SelectionRect,
  barW: number,
  barH: number,
  pad = 8,
): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const midX = (rect.left + rect.right) / 2
  let left = midX - barW / 2
  let top = rect.top - barH - pad
  // If not enough room above, place below selection
  if (top < pad) top = rect.bottom + pad
  left = clamp(left, pad, vw - barW - pad)
  top = clamp(top, pad, vh - barH - pad)
  return { left, top }
}
