import { mapPointToParentViewport, mapRectToParentViewport, rectFromDomRect, type SelectionRect } from '@/utils/selectionToolbar'

export type MarkHandleRects = {
  start: { x: number; y: number; h: number }
  end: { x: number; y: number; h: number }
  /** Union rect in parent viewport — for toolbar placement */
  union: SelectionRect
}

function caretRangeAt(doc: Document, clientX: number, clientY: number): Range | null {
  const d = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  try {
    if (typeof d.caretRangeFromPoint === 'function') {
      const r = d.caretRangeFromPoint(clientX, clientY)
      return r
    }
    if (typeof d.caretPositionFromPoint === 'function') {
      const pos = d.caretPositionFromPoint(clientX, clientY)
      if (!pos?.offsetNode) return null
      const r = doc.createRange()
      r.setStart(pos.offsetNode, pos.offset)
      r.collapse(true)
      return r
    }
  } catch {
    return null
  }
  return null
}

function orderRange(doc: Document, a: Range, b: Range): Range | null {
  try {
    const range = doc.createRange()
    const cmp = a.compareBoundaryPoints(Range.START_TO_START, b)
    if (cmp <= 0) {
      range.setStart(a.startContainer, a.startOffset)
      range.setEnd(b.startContainer, b.startOffset)
    } else {
      range.setStart(b.startContainer, b.startOffset)
      range.setEnd(a.startContainer, a.startOffset)
    }
    if (range.collapsed) return null
    return range
  } catch {
    return null
  }
}

function applyRange(doc: Document, range: Range) {
  const sel = doc.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(range)
}

function isWordChar(ch: string) {
  if (!ch) return false
  // CJK / letters / digits count as selectable units
  return /[\u3400-\u9fff\uF900-\uFAFFa-zA-Z0-9]/.test(ch)
}

/** Expand a collapsed caret to at least one character / word (Huawei long-press). */
function expandCaretToUnit(doc: Document, caret: Range): Range | null {
  try {
    const node = caret.startContainer
    const offset = caret.startOffset
    if (node.nodeType !== Node.TEXT_NODE) {
      // Try surrounding text
      const r = caret.cloneRange()
      if (typeof (r as Range & { expand?: (u: string) => void }).expand === 'function') {
        try {
          ;(r as Range & { expand: (u: string) => void }).expand('character')
          if (!r.collapsed) return r
        } catch {
          /* */
        }
      }
      return null
    }
    const text = node.nodeValue || ''
    if (!text.length) return null
    let i = Math.min(offset, text.length)
    // If caret is between chars, prefer the char under finger (left if at end)
    if (i >= text.length) i = text.length - 1
    if (i > 0 && i < text.length && !isWordChar(text[i]!) && isWordChar(text[i - 1]!)) i -= 1
    if (!isWordChar(text[i]!)) {
      // snap to nearest word char
      let found = -1
      for (let d = 0; d < 8; d++) {
        if (i + d < text.length && isWordChar(text[i + d]!)) {
          found = i + d
          break
        }
        if (i - d >= 0 && isWordChar(text[i - d]!)) {
          found = i - d
          break
        }
      }
      if (found < 0) {
        // fall back: one code unit
        const start = Math.min(offset, text.length - 1)
        if (start < 0) return null
        const r = doc.createRange()
        r.setStart(node, start)
        r.setEnd(node, start + 1)
        return r
      }
      i = found
    }
    const ch = text[i]!
    // Latin word: expand to word boundaries; CJK: single char
    const isCjk = /[\u3400-\u9fff\uF900-\uFAFF]/.test(ch)
    let start = i
    let end = i + 1
    if (!isCjk) {
      while (start > 0 && isWordChar(text[start - 1]!) && !/[\u3400-\u9fff]/.test(text[start - 1]!)) start--
      while (end < text.length && isWordChar(text[end]!) && !/[\u3400-\u9fff]/.test(text[end]!)) end++
    }
    const r = doc.createRange()
    r.setStart(node, start)
    r.setEnd(node, end)
    return r.collapsed ? null : r
  } catch {
    return null
  }
}

function handlePointsFromSel(doc: Document, toParent: boolean): MarkHandleRects | null {
  const sel = doc.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null
  let range: Range
  try {
    range = sel.getRangeAt(0)
  } catch {
    return null
  }
  const rects = range.getClientRects()
  let first: DOMRect
  let last: DOMRect
  let unionBox: DOMRect
  if (!rects.length) {
    const r = range.getBoundingClientRect()
    if (!r.width && !r.height) return null
    first = r
    last = r
    unionBox = r
  } else {
    first = rects[0]!
    last = rects[rects.length - 1]!
    unionBox = range.getBoundingClientRect()
  }
  // Start lollipop: circle on top at left edge; end: circle on bottom at right edge
  let start = { x: first.left, y: first.top, h: Math.max(18, first.height) }
  let end = { x: last.right, y: last.bottom, h: Math.max(18, last.height) }
  let union = rectFromDomRect(unionBox)
  if (toParent) {
    const s = mapPointToParentViewport(start.x, start.y, doc)
    const e = mapPointToParentViewport(end.x, end.y, doc)
    // height scales ~1 with CSS px in iframe
    start = { x: s.x, y: s.y, h: start.h }
    end = { x: e.x, y: e.y, h: end.h }
    union = mapRectToParentViewport(union, doc)
  }
  return { start, end, union }
}

export type MarkDragState = {
  doc: Document
  anchor: Range
  /** parent-viewport coords for EPUB */
  iframe: boolean
}

/**
 * Synthetic mark-mode selection (Huawei-like): drag body to select,
 * then drag custom handles to adjust — does not rely on OS selection handles.
 */
export function createMarkDragController(opts: {
  /** Documents that may contain selectable text (iframe docs or host document). */
  getDocs: () => Document[]
  /** Optional: limit caret hits to this root (TXT/PDF host). */
  getRoot?: () => HTMLElement | null
}) {
  let drag: MarkDragState | null = null
  /** Frozen opposite end while dragging a handle */
  let handleAnchor: { doc: Document; range: Range; which: 'start' | 'end' } | null = null

  function resolveDocPoint(clientX: number, clientY: number): { doc: Document; x: number; y: number } | null {
    const docs = opts.getDocs()
    const root = opts.getRoot?.() ?? null
    for (const doc of docs) {
      const isIframe = doc !== document
      let x = clientX
      let y = clientY
      if (isIframe) {
        try {
          const frame = doc.defaultView?.frameElement as HTMLElement | null
          if (!frame) continue
          const fr = frame.getBoundingClientRect()
          if (clientX < fr.left || clientX > fr.right || clientY < fr.top || clientY > fr.bottom) {
            // Still allow if only one doc
            if (docs.length > 1) continue
          }
          x = clientX - fr.left
          y = clientY - fr.top
        } catch {
          continue
        }
      } else if (root) {
        const r = root.getBoundingClientRect()
        if (clientX < r.left - 8 || clientX > r.right + 8 || clientY < r.top - 8 || clientY > r.bottom + 8) {
          continue
        }
      }
      const caret = caretRangeAt(doc, x, y)
      if (!caret) continue
      if (root && doc === document) {
        const node = caret.startContainer
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
        if (!el || !root.contains(el)) continue
      }
      return { doc, x, y }
    }
    return null
  }

  function beginDrag(clientX: number, clientY: number, optsDrag?: { expandUnit?: boolean }): boolean {
    handleAnchor = null
    const hit = resolveDocPoint(clientX, clientY)
    if (!hit) return false
    const caret = caretRangeAt(hit.doc, hit.x, hit.y)
    if (!caret) return false
    const expand = optsDrag?.expandUnit !== false
    const unit = expand ? expandCaretToUnit(hit.doc, caret) : null
    const initial = unit || caret
    drag = {
      doc: hit.doc,
      // Anchor at start of unit so dragging extends the other end
      anchor: (() => {
        const a = hit.doc.createRange()
        a.setStart(initial.startContainer, initial.startOffset)
        a.collapse(true)
        return a
      })(),
      iframe: hit.doc !== document,
    }
    applyRange(hit.doc, initial)
    return !initial.collapsed || Boolean(unit)
  }

  function moveDrag(clientX: number, clientY: number): boolean {
    if (!drag) return false
    const hit = resolveDocPoint(clientX, clientY)
    if (!hit || hit.doc !== drag.doc) {
      // Map into same doc if possible
      const docs = opts.getDocs()
      const same = docs.find((d) => d === drag!.doc)
      if (!same) return false
      let x = clientX
      let y = clientY
      if (drag.iframe) {
        try {
          const frame = same.defaultView?.frameElement as HTMLElement | null
          if (frame) {
            const fr = frame.getBoundingClientRect()
            x = clientX - fr.left
            y = clientY - fr.top
          }
        } catch {
          return false
        }
      }
      const caret = caretRangeAt(same, x, y)
      if (!caret) return false
      const range = orderRange(same, drag.anchor, caret)
      if (range) applyRange(same, range)
      return Boolean(range)
    }
    const caret = caretRangeAt(hit.doc, hit.x, hit.y)
    if (!caret) return false
    const range = orderRange(hit.doc, drag.anchor, caret)
    if (range) applyRange(hit.doc, range)
    return Boolean(range)
  }

  function endDrag() {
    drag = null
    handleAnchor = null
  }

  function beginHandle(which: 'start' | 'end'): boolean {
    const docs = opts.getDocs()
    for (const doc of docs) {
      const sel = doc.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount < 1) continue
      try {
        const cur = sel.getRangeAt(0)
        const anchor = doc.createRange()
        if (which === 'start') {
          anchor.setStart(cur.endContainer, cur.endOffset)
          anchor.collapse(true)
        } else {
          anchor.setStart(cur.startContainer, cur.startOffset)
          anchor.collapse(true)
        }
        handleAnchor = { doc, range: anchor, which }
        drag = null
        return true
      } catch {
        /* */
      }
    }
    return false
  }

  function moveHandle(clientX: number, clientY: number): boolean {
    if (!handleAnchor) return false
    const doc = handleAnchor.doc
    let x = clientX
    let y = clientY
    if (doc !== document) {
      try {
        const frame = doc.defaultView?.frameElement as HTMLElement | null
        if (frame) {
          const fr = frame.getBoundingClientRect()
          x = clientX - fr.left
          y = clientY - fr.top
        }
      } catch {
        return false
      }
    }
    const caret = caretRangeAt(doc, x, y)
    if (!caret) return false
    const range = orderRange(doc, handleAnchor.range, caret)
    if (range) applyRange(doc, range)
    return Boolean(range)
  }

  function endHandle() {
    handleAnchor = null
  }

  function getHandleRects(): MarkHandleRects | null {
    const docs = opts.getDocs()
    for (const doc of docs) {
      const rects = handlePointsFromSel(doc, doc !== document)
      if (rects) return rects
    }
    return null
  }

  function isDragging() {
    return Boolean(drag || handleAnchor)
  }

  return {
    beginDrag,
    moveDrag,
    endDrag,
    beginHandle,
    moveHandle,
    endHandle,
    getHandleRects,
    isDragging,
  }
}

export type MarkDragController = ReturnType<typeof createMarkDragController>
