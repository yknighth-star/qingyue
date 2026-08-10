/**
 * EPUB paginated media fit — keep figures inside ONE visible page column.
 *
 * Root cause of mobile width spill:
 * epub.js expand() stretches the chapter iframe to the full multicol strip
 * (thousands of px). Inside that iframe, `100vw` / `100%` resolve to the STRIP,
 * not the phone screen — so CSS caps based on vw/% are useless.
 *
 * Fix: always inject pixel page-box caps via #qingyue-media-fit + inline styles,
 * measured from the HOST stage (.epub-container), never from iframe vw.
 */

export const EPUBJS_COLUMN_PADDING_Y = 40
export const EPUB_DUAL_COLUMN_GAP = 40

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
  // Tight phone margins — leave headroom for chrome / captions.
  const maxH = Math.max(96, Math.floor(stageH * (stageH < 700 ? 0.8 : 0.88)))
  if (!opts.dual) {
    return { maxW: Math.max(64, Math.floor(stageW * 0.94)), maxH }
  }
  const maxW = Math.max(48, Math.floor(stageW / 2 - gap / 2))
  return { maxW: Math.max(64, Math.floor(maxW * 0.94)), maxH }
}

/** Fallback CSS only — real caps come from injectMediaFitStyles(box). Never use vw/%. */
export function paginatedMediaCss(): string {
  return `
html body img,
html body picture,
html body video,
html body canvas,
html body svg,
html body figure {
  display: block !important;
  float: none !important;
  min-width: 0 !important;
  object-fit: contain !important;
  box-sizing: border-box !important;
  break-inside: avoid-column !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
`.trim()
}

export function paginatedMediaThemeRules(): Record<string, Record<string, string>> {
  const media = {
    display: 'block !important',
    float: 'none !important',
    'min-width': '0 !important',
    'object-fit': 'contain !important',
    'box-sizing': 'border-box !important',
    'break-inside': 'avoid-column !important',
    'page-break-inside': 'avoid !important',
    '-webkit-column-break-inside': 'avoid !important',
    'background-color': 'transparent !important',
  }
  return {
    'img, picture, video, canvas, svg, figure': media,
    'div:has(> img), div:has(> svg), div:has(> picture), p:has(> img), p:has(> svg)': {
      'min-width': '0 !important',
      'box-sizing': 'border-box !important',
      'background-color': 'transparent !important',
    },
    'figcaption, caption, [class*="caption"], [class*="image-title"], [class*="img-title"]': {
      opacity: '1 !important',
    },
  }
}

/**
 * Authoritative pixel caps — pinned last under <html>. Uses px only (no vw/%).
 */
export function injectMediaFitStyles(doc: Document, box: ColumnPageBox, mode: MediaFitMode): void {
  const id = 'qingyue-media-fit'
  let el = doc.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = doc.createElement('style')
    el.id = id
  }
  const root = doc.documentElement
  if (el.parentNode) el.parentNode.removeChild(el)
  root.appendChild(el)

  root.style.setProperty('--qy-page-w', `${box.maxW}px`)
  root.style.setProperty('--qy-page-h', `${box.maxH}px`)

  if (mode === 'scroll') {
    el.textContent = `
html body img, html body picture, html body video, html body canvas, html body svg {
  max-width: 100% !important;
  height: auto !important;
  object-fit: contain !important;
}
`.trim()
    return
  }

  el.textContent = `
html body img,
html body img[class],
html body img[style],
html body picture,
html body video,
html body canvas,
html body svg,
html body svg[class],
html body figure {
  display: block !important;
  float: none !important;
  clear: both !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: ${box.maxW}px !important;
  max-height: ${box.maxH}px !important;
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
html body p:has(> svg),
html body center:has(> img),
html body span:has(> img) {
  max-width: ${box.maxW}px !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
  overflow-x: hidden !important;
  break-inside: avoid-column !important;
  -webkit-column-break-inside: avoid !important;
}
html body table {
  max-width: ${box.maxW}px !important;
  table-layout: fixed !important;
  word-break: break-word !important;
  box-sizing: border-box !important;
}
`.trim()
}

function parseSizeAttr(el: Element, name: string): number {
  const raw = el.getAttribute(name)
  if (!raw || /%|em|rem|vw|vh|ex|ch/i.test(raw)) return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function resolveMediaIntrinsicSize(el: HTMLElement | SVGElement): { w: number; h: number } | null {
  const attrW = parseSizeAttr(el, 'width')
  const attrH = parseSizeAttr(el, 'height')

  if (el instanceof HTMLImageElement) {
    const nw = el.naturalWidth || 0
    const nh = el.naturalHeight || 0
    // 1×1 / tiny decoded bitmaps often rely on HTML attrs for layout size.
    if (attrW >= 2 && attrH >= 2 && (nw <= 2 || nh <= 2 || attrW > nw * 2 || attrH > nh * 2)) {
      return { w: attrW, h: attrH }
    }
    if (nw >= 2 && nh >= 2) return { w: nw, h: nh }
  } else if (el instanceof HTMLVideoElement) {
    if (el.videoWidth >= 2 && el.videoHeight >= 2) return { w: el.videoWidth, h: el.videoHeight }
  } else if (el instanceof HTMLCanvasElement) {
    if (el.width >= 2 && el.height >= 2) return { w: el.width, h: el.height }
  } else if (el instanceof SVGElement) {
    let w = attrW
    let h = attrH
    if (!w || !h) {
      const vb = el.getAttribute('viewBox')?.trim().split(/[\s,]+/)
      if (vb && vb.length >= 4) {
        w = parseFloat(vb[2]) || 0
        h = parseFloat(vb[3]) || 0
      }
    }
    if (w >= 2 && h >= 2) return { w, h }
  }

  if (attrW >= 2 && attrH >= 2) return { w: attrW, h: attrH }

  if (el instanceof HTMLElement) {
    const sw = parseFloat(el.style.width)
    const sh = parseFloat(el.style.height)
    if (
      Number.isFinite(sw) &&
      Number.isFinite(sh) &&
      sw >= 2 &&
      sh >= 2 &&
      /px/i.test(el.style.width || '') &&
      /px/i.test(el.style.height || '')
    ) {
      return { w: sw, h: sh }
    }
  }
  return null
}

function applyScrollMedia(el: HTMLElement | SVGElement) {
  el.style.setProperty('max-width', '100%', 'important')
  el.style.removeProperty('max-height')
  el.style.removeProperty('width')
  el.style.removeProperty('height')
}

export function clampMediaAncestors(el: HTMLElement, box: ColumnPageBox): void {
  const maxWCss = `${box.maxW}px`
  const doc = el.ownerDocument
  let p: HTMLElement | null = el.parentElement
  let depth = 0
  while (p && p !== doc.body && p !== doc.documentElement && depth < 12) {
    p.style.setProperty('max-width', maxWCss, 'important')
    p.style.setProperty('min-width', '0', 'important')
    p.style.setProperty('box-sizing', 'border-box', 'important')
    p.style.setProperty('overflow-x', 'hidden', 'important')
    p.style.setProperty('break-inside', 'avoid-column', 'important')
    p.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')
    p.style.setProperty('float', 'none', 'important')

    const attrW = p.getAttribute('width') || ''
    const styleW = p.style.width || ''
    if (/px|pt|cm|mm|in|%/i.test(attrW) || /px|pt|cm|mm|in|%/i.test(styleW)) {
      p.style.setProperty('width', 'auto', 'important')
    }
    p = p.parentElement
    depth += 1
  }
}

function applyPaginatedMedia(el: HTMLElement | SVGElement, box: ColumnPageBox) {
  el.style.setProperty('display', 'block', 'important')
  el.style.setProperty('float', 'none', 'important')
  el.style.setProperty('clear', 'both', 'important')
  el.style.setProperty('min-width', '0', 'important')
  el.style.setProperty('min-height', '0', 'important')
  el.style.setProperty('max-width', `${box.maxW}px`, 'important')
  el.style.setProperty('max-height', `${box.maxH}px`, 'important')
  el.style.setProperty('object-fit', 'contain', 'important')
  el.style.setProperty('box-sizing', 'border-box', 'important')
  el.style.setProperty('break-inside', 'avoid-column', 'important')
  el.style.setProperty('page-break-inside', 'avoid', 'important')
  el.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')

  const intrinsic = resolveMediaIntrinsicSize(el)
  if (intrinsic) {
    const scale = Math.min(1, box.maxW / intrinsic.w, box.maxH / intrinsic.h)
    const w = Math.max(1, Math.round(intrinsic.w * scale))
    const h = Math.max(1, Math.round(intrinsic.h * scale))
    el.style.setProperty('width', `${w}px`, 'important')
    el.style.setProperty('height', `${h}px`, 'important')
  } else {
    // Not decoded yet — still force a hard width ceiling so layout cannot expand columns.
    el.style.setProperty('width', `${box.maxW}px`, 'important')
    el.style.setProperty('height', 'auto', 'important')
  }

  if (el instanceof HTMLElement) clampMediaAncestors(el, box)
}

export function fitWideBlocksInDocument(doc: Document, box: ColumnPageBox): void {
  const maxWCss = `${box.maxW}px`
  doc.querySelectorAll('table, pre').forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    node.style.setProperty('max-width', maxWCss, 'important')
    node.style.setProperty('width', 'auto', 'important')
    node.style.setProperty('box-sizing', 'border-box', 'important')
    if (node.tagName.toLowerCase() === 'table') {
      node.style.setProperty('table-layout', 'fixed', 'important')
      node.style.setProperty('word-break', 'break-word', 'important')
    }
  })
}

/**
 * Fit every media node into the host page box. Call after theme paint / load / relocate.
 */
export function fitMediaInDocument(
  doc: Document,
  box: ColumnPageBox,
  mode: MediaFitMode,
): void {
  injectMediaFitStyles(doc, box, mode)

  doc.querySelectorAll('img, video, canvas, picture, svg').forEach((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
    if (node instanceof HTMLElement && node.tagName.toLowerCase() === 'picture') {
      const img = node.querySelector('img')
      if (img instanceof HTMLImageElement) {
        if (mode === 'scroll') applyScrollMedia(img)
        else applyPaginatedMedia(img, box)
      }
      if (mode === 'paginated') {
        node.style.setProperty('max-width', `${box.maxW}px`, 'important')
        node.style.setProperty('display', 'block', 'important')
        clampMediaAncestors(node, box)
      }
      return
    }
    if (mode === 'scroll') applyScrollMedia(node)
    else applyPaginatedMedia(node, box)
  })

  if (mode !== 'paginated') return

  fitWideBlocksInDocument(doc, box)

  // Verify: anything still wider/taller/fragmented → shrink harder.
  doc.querySelectorAll('img, svg, video, canvas').forEach((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
    let rects: DOMRectList
    try {
      rects = node.getClientRects()
    } catch {
      return
    }
    const w = rects[0]?.width ?? 0
    const h = rects[0]?.height ?? 0
    if (rects.length <= 1 && w <= box.maxW + 1 && h <= box.maxH + 1) return
    applyPaginatedMedia(node, {
      maxW: Math.max(48, Math.floor(box.maxW * 0.85)),
      maxH: Math.max(48, Math.floor(box.maxH * 0.85)),
    })
  })
}

const LOAD_REFIT_ATTR = 'data-qy-media-refit'

export function bindMediaLoadRefit(
  doc: Document,
  onChange: () => void,
  debounceMs = 60,
): () => void {
  const root = doc.documentElement
  if (root.getAttribute(LOAD_REFIT_ATTR) === '1') {
    return () => {
      /* already bound */
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
    else schedule()
  })

  return () => {
    if (timer != null && win) win.clearTimeout(timer)
    doc.removeEventListener('load', onLoad, true)
    root.removeAttribute(LOAD_REFIT_ATTR)
  }
}
