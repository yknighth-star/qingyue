/**
 * EPUB paginated media fit — keep figures inside a single CSS-column page box.
 * Scroll mode only constrains width (natural height OK).
 *
 * Critical: never use max-width:100% in paginated mode — inside epub.js multicol
 * that % resolves against the *expanded* column strip, so images spill into the
 * next page. Always cap with pixel page-box sizes.
 *
 * Never strip HTML width/height attributes. Never set width/height:auto !important
 * alone — that collapses 1×1 bitmaps that rely on HTML presentational size
 * (see scripts/selftest-epub-images.mjs).
 */

/** epub.js contents.columns() sets padding-top/bottom 20px each. */
export const EPUBJS_COLUMN_PADDING_Y = 40

/** Matches EpubEngine dual-spread gap when dual is on. */
export const EPUB_DUAL_COLUMN_GAP = 40

const PAGE_BOX_SAFETY = 8

export type MediaFitMode = 'paginated' | 'scroll'

export type ColumnPageBox = {
  maxW: number
  maxH: number
}

export function resolveColumnPageBox(opts: {
  stageW: number
  stageH: number
  dual: boolean
  gap?: number
}): ColumnPageBox {
  const gap = opts.gap ?? EPUB_DUAL_COLUMN_GAP
  const stageW = Math.max(1, Math.round(opts.stageW))
  const stageH = Math.max(1, Math.round(opts.stageH))
  const maxH = Math.max(48, stageH - EPUBJS_COLUMN_PADDING_Y - PAGE_BOX_SAFETY)
  if (!opts.dual) {
    return { maxW: Math.max(64, Math.floor(stageW * 0.96)), maxH }
  }
  // Half-page column: (stageW / 2) - gap/2, matching epub.js dual divisor math.
  const maxW = Math.max(48, Math.floor(stageW / 2 - gap / 2))
  return { maxW: Math.max(64, Math.floor(maxW * 0.96)), maxH }
}

/**
 * Baseline stylesheet for paginated chapters.
 * Prefer 100vw as CSS fallback; JS still applies pixel caps (authoritative).
 */
export function paginatedMediaCss(): string {
  return `
html body img,
html body img[class],
html body picture,
html body video,
html body canvas,
html body svg,
html body figure {
  max-width: 100vw !important;
  max-height: 92vh !important;
  object-fit: contain !important;
  box-sizing: border-box !important;
  break-inside: avoid-column !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
html body figure,
html body div:has(> img),
html body div:has(> picture),
html body div:has(> svg),
html body p:has(> img),
html body p:has(> picture),
html body p:has(> svg) {
  max-width: 100vw !important;
  box-sizing: border-box !important;
  break-inside: avoid-column !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
html body table {
  max-width: 100vw !important;
  table-layout: fixed !important;
  word-break: break-word !important;
  box-sizing: border-box !important;
}
`.trim()
}

/** Rules object for epub.js themes.default() when pageTurn !== scroll. */
export function paginatedMediaThemeRules(): Record<string, Record<string, string>> {
  const media = {
    'max-width': '100vw !important',
    'max-height': '92vh !important',
    'object-fit': 'contain !important',
    'box-sizing': 'border-box !important',
    'break-inside': 'avoid-column !important',
    'page-break-inside': 'avoid !important',
    '-webkit-column-break-inside': 'avoid !important',
    'background-color': 'transparent !important',
  }
  const wrapAvoid = {
    'max-width': '100vw !important',
    'box-sizing': 'border-box !important',
    'break-inside': 'avoid-column !important',
    'page-break-inside': 'avoid !important',
    '-webkit-column-break-inside': 'avoid !important',
    'background-color': 'transparent !important',
  }
  return {
    'img, picture, video, canvas, svg, figure': media,
    'div:has(> img), div:has(> svg), div:has(> picture), p:has(> img), p:has(> svg)': wrapAvoid,
    'figcaption, caption, [class*="caption"], [class*="image-title"], [class*="img-title"]': {
      opacity: '1 !important',
    },
    table: {
      'max-width': '100vw !important',
      'table-layout': 'fixed !important',
      'word-break': 'break-word !important',
      'box-sizing': 'border-box !important',
    },
  }
}

function parseSizeAttr(el: Element, name: string): number {
  const raw = el.getAttribute(name)
  if (!raw || /%|em|rem|vw|vh|ex|ch/i.test(raw)) return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Prefer natural pixels for bitmaps (truthful size), then HTML attrs, then current box.
 * Skip %-based width/height attributes (common in CN EPUBs).
 */
export function resolveMediaIntrinsicSize(el: HTMLElement | SVGElement): { w: number; h: number } | null {
  const attrW = parseSizeAttr(el, 'width')
  const attrH = parseSizeAttr(el, 'height')

  let natW = 0
  let natH = 0
  if (el instanceof HTMLImageElement) {
    natW = el.naturalWidth || 0
    natH = el.naturalHeight || 0
    // Decoded bitmap size is authoritative when available.
    if (natW >= 2 && natH >= 2) return { w: natW, h: natH }
  } else if (el instanceof HTMLVideoElement) {
    natW = el.videoWidth || 0
    natH = el.videoHeight || 0
    if (natW >= 2 && natH >= 2) return { w: natW, h: natH }
  } else if (el instanceof HTMLCanvasElement) {
    natW = el.width || 0
    natH = el.height || 0
    if (natW >= 2 && natH >= 2) return { w: natW, h: natH }
  } else if (el instanceof SVGElement) {
    natW = attrW
    natH = attrH
    if (!natW || !natH) {
      const vb = el.getAttribute('viewBox')?.trim().split(/[\s,]+/)
      if (vb && vb.length >= 4) {
        natW = parseFloat(vb[2]) || 0
        natH = parseFloat(vb[3]) || 0
      }
    }
  }

  if (attrW >= 2 && attrH >= 2) return { w: attrW, h: attrH }
  if (natW >= 2 && natH >= 2) return { w: natW, h: natH }
  if (attrW >= 2 && natH >= 2) return { w: attrW, h: natH }
  if (natW >= 2 && attrH >= 2) return { w: natW, h: attrH }

  // Inline style width/height in px (publisher often sizes covers this way).
  if (el instanceof HTMLElement) {
    const sw = parseFloat(el.style.width)
    const sh = parseFloat(el.style.height)
    if (
      Number.isFinite(sw) &&
      Number.isFinite(sh) &&
      sw >= 2 &&
      sh >= 2 &&
      /px/i.test(el.style.width) &&
      /px/i.test(el.style.height)
    ) {
      return { w: sw, h: sh }
    }
  }

  try {
    // Prefer getClientRects union only when not fragmented; else skip (unreliable).
    const rects = el.getClientRects()
    if (rects.length === 1 && rects[0].width >= 2 && rects[0].height >= 2) {
      return { w: rects[0].width, h: rects[0].height }
    }
  } catch {
    /* */
  }
  return null
}

function applyScrollMedia(el: HTMLElement | SVGElement) {
  el.style.setProperty('max-width', '100%', 'important')
  el.style.removeProperty('max-height')
  el.style.removeProperty('width')
  el.style.removeProperty('height')
}

function applyPaginatedMedia(el: HTMLElement | SVGElement, box: ColumnPageBox) {
  // Pixel caps only — never max-width:100% (multicol % = whole strip).
  el.style.setProperty('max-width', `${box.maxW}px`, 'important')
  el.style.setProperty('max-height', `${box.maxH}px`, 'important')
  el.style.setProperty('object-fit', 'contain', 'important')
  el.style.setProperty('box-sizing', 'border-box', 'important')
  el.style.setProperty('break-inside', 'avoid-column', 'important')
  el.style.setProperty('page-break-inside', 'avoid', 'important')
  el.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')

  const intrinsic = resolveMediaIntrinsicSize(el)
  if (!intrinsic) return

  const scale = Math.min(1, box.maxW / intrinsic.w, box.maxH / intrinsic.h)
  const w = Math.max(1, Math.round(intrinsic.w * scale))
  const h = Math.max(1, Math.round(intrinsic.h * scale))
  // Explicit px beats presentational attrs and avoids 1×1 collapse from height:auto.
  el.style.setProperty('width', `${w}px`, 'important')
  el.style.setProperty('height', `${h}px`, 'important')
}

function applyWrapperAvoid(el: HTMLElement, box: ColumnPageBox) {
  el.style.setProperty('max-width', `${box.maxW}px`, 'important')
  el.style.setProperty('box-sizing', 'border-box', 'important')
  el.style.setProperty('break-inside', 'avoid-column', 'important')
  el.style.setProperty('page-break-inside', 'avoid', 'important')
  el.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')
}

/**
 * Clamp publisher tables / fixed-width blocks that spill into the next column.
 */
export function fitWideBlocksInDocument(doc: Document, box: ColumnPageBox): void {
  const maxWCss = `${box.maxW}px`

  doc.querySelectorAll('table').forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    node.style.setProperty('max-width', maxWCss, 'important')
    node.style.setProperty('width', 'auto', 'important')
    node.style.setProperty('table-layout', 'fixed', 'important')
    node.style.setProperty('word-break', 'break-word', 'important')
    node.style.setProperty('box-sizing', 'border-box', 'important')
  })

  // Fixed-width / nowrap blocks that visually act like "cards".
  doc.querySelectorAll('div, section, article, center, pre').forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    const styleW = node.style.width || node.getAttribute('width') || ''
    const hasFixed =
      /px|pt|cm|mm|in/i.test(styleW) ||
      node.style.whiteSpace === 'nowrap' ||
      node.getAttribute('align') === 'center'
    let measured = 0
    try {
      measured = node.getBoundingClientRect().width
    } catch {
      /* */
    }
    if (!hasFixed && measured <= box.maxW + 4) return
    if (measured > 0 && measured <= box.maxW + 4 && !hasFixed) return
    node.style.setProperty('max-width', maxWCss, 'important')
    node.style.setProperty('box-sizing', 'border-box', 'important')
    node.style.setProperty('overflow-x', 'hidden', 'important')
    if (/px|pt|cm|mm|in/i.test(styleW)) {
      node.style.setProperty('width', 'auto', 'important')
    }
  })
}

/**
 * Fit media into the column page box. Does not remove width/height attributes.
 */
export function fitMediaInDocument(
  doc: Document,
  box: ColumnPageBox,
  mode: MediaFitMode,
): void {
  doc.querySelectorAll('img, video, canvas, picture, svg').forEach((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
    if (node instanceof HTMLElement && node.tagName.toLowerCase() === 'picture') {
      const img = node.querySelector('img')
      if (img instanceof HTMLImageElement) {
        if (mode === 'scroll') applyScrollMedia(img)
        else applyPaginatedMedia(img, box)
      }
      if (mode === 'paginated') applyWrapperAvoid(node, box)
      return
    }
    if (mode === 'scroll') applyScrollMedia(node)
    else applyPaginatedMedia(node, box)
  })

  if (mode !== 'paginated') return

  doc.querySelectorAll('figure').forEach((node) => {
    if (node instanceof HTMLElement) applyWrapperAvoid(node, box)
  })
  doc
    .querySelectorAll(
      'div:has(> img), div:has(> picture), div:has(> svg), p:has(> img), p:has(> picture), p:has(> svg)',
    )
    .forEach((node) => {
      if (node instanceof HTMLElement) applyWrapperAvoid(node, box)
    })

  fitWideBlocksInDocument(doc, box)

  // Second pass: anything still fragmented across columns gets forced smaller.
  doc.querySelectorAll('img, svg, video, canvas').forEach((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
    let rects: DOMRectList
    try {
      rects = node.getClientRects()
    } catch {
      return
    }
    if (rects.length <= 1) {
      const w = rects[0]?.width ?? 0
      if (w <= box.maxW + 2) return
    }
    applyPaginatedMedia(node, {
      maxW: Math.max(64, Math.floor(box.maxW * 0.92)),
      maxH: Math.max(64, Math.floor(box.maxH * 0.92)),
    })
  })
}

const LOAD_REFIT_ATTR = 'data-qy-media-refit'

/**
 * Bind image/video load → debounced onChange. Idempotent per document.
 * Returns dispose function.
 */
export function bindMediaLoadRefit(
  doc: Document,
  onChange: () => void,
  debounceMs = 80,
): () => void {
  const root = doc.documentElement
  if (root.getAttribute(LOAD_REFIT_ATTR) === '1') {
    return () => {
      /* already bound for this document */
    }
  }
  root.setAttribute(LOAD_REFIT_ATTR, '1')

  const win = doc.defaultView
  let timer: number | null = null
  const schedule = () => {
    if (!win) {
      onChange()
      return
    }
    if (timer != null) win.clearTimeout(timer)
    timer = win.setTimeout(() => {
      timer = null
      onChange()
    }, debounceMs)
  }

  const onLoad = (ev: Event) => {
    const t = ev.target
    if (!(t instanceof Element)) return
    const tag = t.tagName.toLowerCase()
    if (tag === 'img' || tag === 'video' || tag === 'source') schedule()
  }

  doc.addEventListener('load', onLoad, true)
  doc.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', schedule, { once: true })
  })

  return () => {
    if (timer != null && win) win.clearTimeout(timer)
    doc.removeEventListener('load', onLoad, true)
    root.removeAttribute(LOAD_REFIT_ATTR)
  }
}
