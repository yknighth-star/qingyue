/** Hide insertion caret in reading surfaces while keeping drag-to-select. */

const STYLE_ID = 'h5-reader-caret-style'

const CARET_CSS = `
html, body {
  cursor: default !important;
  caret-color: transparent !important;
  outline: none !important;
  -webkit-user-select: text !important;
  user-select: text !important;
}
a, a * { cursor: pointer !important; }
*:focus { outline: none !important; caret-color: transparent !important; }
`

function clearCollapsedSelection(doc: Document) {
  const sel = doc.getSelection()
  if (!sel) return
  if (sel.isCollapsed || !sel.toString().trim()) {
    sel.removeAllRanges()
  }
  const active = doc.activeElement
  if (active instanceof HTMLElement && active !== doc.body) {
    active.blur()
  }
}

function hasRangeSelection(doc: Document) {
  const sel = doc.getSelection()
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim())
}

export function injectCaretSuppression(doc: Document) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.textContent = CARET_CSS
    ;(doc.head || doc.documentElement).appendChild(style)
  }

  if ((doc as Document & { __h5CaretBound?: boolean }).__h5CaretBound) return
  ;(doc as Document & { __h5CaretBound?: boolean }).__h5CaretBound = true

  let dragging = false
  let startX = 0
  let startY = 0

  doc.addEventListener(
    'mousedown',
    (e) => {
      dragging = false
      startX = e.clientX
      startY = e.clientY
    },
    true,
  )

  doc.addEventListener(
    'mousemove',
    (e) => {
      if (!e.buttons) return
      if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) {
        dragging = true
      }
    },
    true,
  )

  const end = () => {
    window.setTimeout(() => {
      // Plain click: drop caret. Drag-select: keep the range for annotate bar.
      if (!dragging && !hasRangeSelection(doc)) clearCollapsedSelection(doc)
      dragging = false
    }, 0)
  }

  doc.addEventListener('mouseup', end, true)
  doc.addEventListener('blur', () => {
    if (!hasRangeSelection(doc)) clearCollapsedSelection(doc)
  }, true)
}

export function suppressHostCaret(el: HTMLElement) {
  el.style.caretColor = 'transparent'
  el.style.cursor = 'default'
  el.style.outline = 'none'
  el.style.userSelect = 'text'
  ;(el.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'text'

  if ((el as HTMLElement & { __h5CaretBound?: boolean }).__h5CaretBound) return
  ;(el as HTMLElement & { __h5CaretBound?: boolean }).__h5CaretBound = true

  let dragging = false
  let startX = 0
  let startY = 0

  el.addEventListener('mousedown', (e) => {
    dragging = false
    startX = e.clientX
    startY = e.clientY
  })

  el.addEventListener('mousemove', (e) => {
    if (!e.buttons) return
    if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) {
      dragging = true
    }
  })

  el.addEventListener('mouseup', () => {
    window.setTimeout(() => {
      if (!dragging) {
        const sel = el.ownerDocument.getSelection()
        if (sel && (sel.isCollapsed || !sel.toString().trim())) sel.removeAllRanges()
      }
      dragging = false
    }, 0)
  })
}
