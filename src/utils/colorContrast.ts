/** Cross-iframe-safe element checks (parent `instanceof` is false for iframe nodes). */
export function isHtmlElement(node: Node | null | undefined): node is HTMLElement {
  return !!node && node.nodeType === 1 && typeof (node as HTMLElement).style !== 'undefined'
}

export function isSvgSvgElement(node: Node | null | undefined): node is SVGSVGElement {
  return isHtmlElement(node) && (node as Element).tagName.toLowerCase() === 'svg'
}

export function isSvgGeometryElement(node: Node | null | undefined): node is SVGGeometryElement {
  if (!node || node.nodeType !== 1) return false
  const tag = (node as Element).tagName.toLowerCase()
  return tag === 'path' || tag === 'rect' || tag === 'circle' || tag === 'ellipse' || tag === 'polygon' || tag === 'polyline' || tag === 'line'
}

/** Parse CSS color to sRGB 0–255. Supports #rgb/#rrggbb/#rrggbbaa and rgb(a)(). */
export function parseCssColor(
  input: string,
): { r: number; g: number; b: number; a: number } | null {
  const s = (input || '').trim().toLowerCase()
  if (!s || s === 'transparent' || s === 'inherit' || s === 'currentcolor') return null

  if (s[0] === '#') {
    const hex = s.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1
      if ([r, g, b].some((n) => Number.isNaN(n))) return null
      return { r, g, b, a }
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      if ([r, g, b].some((n) => Number.isNaN(n))) return null
      return { r, g, b, a }
    }
    return null
  }

  const m = s.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)$/,
  )
  if (!m) return null
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  let a = 1
  if (m[4] != null) {
    a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  }
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null
  return { r, g, b, a }
}

/** WCAG relative luminance 0–1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function isTransparentCssColor(color: string): boolean {
  if (!color) return true
  const t = color.trim().toLowerCase()
  if (t === 'transparent' || t === 'rgba(0, 0, 0, 0)' || t === 'rgba(0,0,0,0)') return true
  const rgb = parseCssColor(color)
  return !rgb || rgb.a < 0.12
}

/**
 * Pure white on dark caption bars. themeBg (sepia/green) is too close to some
 * publisher dark greys and still fails on PC after theme re-inject.
 */
export const LIGHT_ON_DARK_FG = '#ffffff'

/**
 * Pick readable text on a solid surface.
 * Dark decorative bars (figure titles) keep light glyphs; light surfaces use theme fg.
 * Returns null when surface is transparent — caller should inherit.
 */
export function contrastTextForBackground(
  backgroundCss: string,
  themeFg: string,
  _themeBg: string,
): string | null {
  if (isTransparentCssColor(backgroundCss)) return null
  const rgb = parseCssColor(backgroundCss)
  if (!rgb) return themeFg
  const L = relativeLuminance(rgb.r, rgb.g, rgb.b)
  // Dark pill / caption bars — always max-contrast white (not cream themeBg).
  if (L < 0.42) return LIGHT_ON_DARK_FG
  return themeFg
}

export type SvgBand = { x: number; y: number; width: number; height: number }

/**
 * Wide dark shapes in the upper band of an SVG (title capsules like 「朱重八家族」).
 * More reliable than isPointInFill when PC layout/getBBox is still settling.
 * Also treats <image> strips (CN EPUB often embeds the black pill as a bitmap).
 */
export function collectSvgTitleBands(
  svg: SVGSVGElement,
  currentColor: string,
): SvgBand[] {
  let sw = 0
  let sh = 0
  try {
    const vb = svg.viewBox?.baseVal
    if (vb && vb.width > 0) {
      sw = vb.width
      sh = vb.height
    } else {
      const b = svg.getBBox()
      sw = b.width
      sh = b.height
    }
  } catch {
    return []
  }
  if (sw < 8 || sh < 8) return []

  const bands: SvgBand[] = []
  const pushIfTitleBand = (b: { x: number; y: number; width: number; height: number }) => {
    if (b.width < sw * 0.35) return
    if (b.height > sh * 0.45) return
    if (b.y + b.height / 2 > sh * 0.42) return
    bands.push({ x: b.x, y: b.y, width: b.width, height: b.height })
  }

  const shapes = svg.querySelectorAll('rect, path, ellipse, polygon')
  for (const shape of shapes) {
    if (!isSvgGeometryElement(shape)) continue
    const paint = shapeFillPaint(shape)
    if (!paint || !isDarkPaint(paint, currentColor)) continue
    try {
      pushIfTitleBand(shape.getBBox())
    } catch {
      /* */
    }
  }

  // Bitmap title pills inside SVG
  svg.querySelectorAll('image').forEach((img) => {
    try {
      pushIfTitleBand(img.getBBox())
    } catch {
      /* */
    }
  })

  return bands
}

export function pointInSvgBands(cx: number, cy: number, bands: SvgBand[]): boolean {
  for (const b of bands) {
    if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) return true
  }
  return false
}

/** Figure-title chrome: skip chapter titleReset (position:static kills overlay captions). */
export function isFigureTitleChrome(el: Element): boolean {
  if (isFigureTitleLike(el)) return true
  if (el.closest?.('figure, figcaption')) return true
  const parent = el.parentElement
  if (parent?.querySelector(':scope > img, :scope > svg, :scope > picture, :scope > object')) {
    const text = (el.textContent || '').replace(/\s+/g, '').trim()
    if (text.length > 0 && text.length <= 32) return true
  }
  return false
}

/** True when a solid background is dark enough to keep (decorative), not wash away. */
export function isDarkDecorativeBackground(backgroundCss: string): boolean {
  if (isTransparentCssColor(backgroundCss)) return false
  const rgb = parseCssColor(backgroundCss)
  if (!rgb) return false
  return relativeLuminance(rgb.r, rgb.g, rgb.b) < 0.42
}

const TITLE_CLASS_RE =
  /caption|fuming|img-title|image-title|pic-title|tu-ti|biaoti|btitle|chapter-title|kindle-cn-title|titlepage|\btitle\b/i

/** Figure/section title bars that commonly sit on black pills in CN EPUBs. */
export function isFigureTitleLike(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'figcaption' || tag === 'caption' || tag === 'cite') return true
  const cls = isHtmlElement(el) ? el.className || '' : ''
  if (typeof cls === 'string' && TITLE_CLASS_RE.test(cls)) return true
  const id = el.id || ''
  if (TITLE_CLASS_RE.test(id)) return true
  // Short centered heading-like blocks (e.g. 「赈灾物品」)
  if (isHtmlElement(el)) {
    const align = (el.getAttribute('align') || el.style.textAlign || '').toLowerCase()
    const text = (el.textContent || '').replace(/\s+/g, '').trim()
    if (text.length > 0 && text.length <= 24 && /center/i.test(align)) return true
  }
  return false
}

/**
 * Pull color tokens out of background-image (gradients / solid images as css colors).
 * Ignores url(...) illustration backgrounds.
 */
export function colorsFromBackgroundImage(backgroundImage: string): string[] {
  const bi = (backgroundImage || '').trim()
  if (!bi || bi === 'none') return []
  if (/url\(/i.test(bi) && !/gradient\(/i.test(bi)) return []
  const out: string[] = []
  const hexRe = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi
  const rgbRe = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.%]+)?\s*\)/gi
  for (const m of bi.match(hexRe) || []) out.push(m)
  for (const m of bi.match(rgbRe) || []) out.push(m)
  return out
}

/**
 * Effective surface color for contrast decisions.
 * Prefers opaque background-color; falls back to dark gradient stops / bgcolor attr.
 * ::before/::after only when they cover a large fraction of the element (full title bars),
 * never tiny ◆ bullets — pass `ignorePseudos: true` for wash / short-label decisions.
 */
export function resolveSurfaceBackgroundCss(
  el: HTMLElement,
  cs: CSSStyleDeclaration,
  win?: Window | null,
  opts?: { ignorePseudos?: boolean },
): string | null {
  const solid = cs.backgroundColor
  if (!isTransparentCssColor(solid)) return solid

  const attr = el.getAttribute('bgcolor')
  if (attr) {
    const parsed = parseCssColor(attr.startsWith('#') ? attr : `#${attr}`)
    if (parsed) return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`
    const asCss = parseCssColor(attr)
    if (asCss) return `rgb(${asCss.r}, ${asCss.g}, ${asCss.b})`
  }

  const fromGrad = colorsFromBackgroundImage(cs.backgroundImage)
  for (const c of fromGrad) {
    if (isDarkDecorativeBackground(c)) return c
  }
  for (const c of fromGrad) {
    if (!isTransparentCssColor(c)) return c
  }

  if (opts?.ignorePseudos || !win) return null

  let elBox: DOMRect | null = null
  try {
    elBox = el.getBoundingClientRect()
  } catch {
    elBox = null
  }
  for (const pseudo of ['::before', '::after'] as const) {
    try {
      const pcs = win.getComputedStyle(el, pseudo)
      if (!pcs || pcs.content === 'none' || pcs.content === 'normal') continue
      if (elBox && elBox.width > 0 && elBox.height > 0) {
        const pw = Number.parseFloat(pcs.width) || 0
        const ph = Number.parseFloat(pcs.height) || 0
        if (pw > 0 && ph > 0) {
          const cover = (pw * ph) / (elBox.width * elBox.height)
          if (cover < 0.35) continue
        } else {
          continue
        }
      } else {
        continue
      }
      const pbg = pcs.backgroundColor
      if (!isTransparentCssColor(pbg)) return pbg
      for (const c of colorsFromBackgroundImage(pcs.backgroundImage)) {
        if (isDarkDecorativeBackground(c)) return c
      }
    } catch {
      /* */
    }
  }

  return null
}

/**
 * True when background-image:url(...) likely paints a full title bar / capsule,
 * not a small left bullet icon.
 *
 * Real CN EPUB pattern (明朝 p_title): light/white background-color + url(blob)
 * black capsule image. background-size is often auto/no-repeat — must still count.
 */
export function urlBackgroundLikelyTitleBar(cs: CSSStyleDeclaration, rect: DomRectLike): boolean {
  const bi = (cs.backgroundImage || '').trim()
  if (!bi || bi === 'none' || !/url\(/i.test(bi) || /gradient\(/i.test(bi)) return false
  const size = (cs.backgroundSize || '').trim().toLowerCase()
  const repeat = (cs.backgroundRepeat || '').toLowerCase()
  if (size === 'cover' || size === 'contain') return true
  if (/(^|\s)100%\s+100%($|\s)/.test(size) || size === '100%') return true
  const pxPair = size.match(/([\d.]+)\s*px\s+([\d.]+)\s*px/)
  if (pxPair) {
    const w = Number.parseFloat(pxPair[1])
    const h = Number.parseFloat(pxPair[2])
    // Tiny bullet icon
    if (w <= 32 && h <= 32) return false
    if (w >= rect.width * 0.5 && h >= Math.max(12, rect.height * 0.45)) return true
  }
  if (repeat.includes('repeat-x') && rect.height > 0 && rect.height <= 96) return true
  // Explicit small single-token size (14px / 1em) + no-repeat → bullet
  if (repeat.includes('no-repeat')) {
    const one = size.match(/^([\d.]+)(px|em)$/)
    if (one) {
      const n = Number.parseFloat(one[1])
      if (one[2] === 'px' && n <= 32) return false
      if (one[2] === 'em' && n <= 2) return false
    }
  }
  // Title-row geometry + any url: treat as capsule (covers auto-sized blob bars).
  if (rect.width >= 80 && rect.height > 0 && rect.height <= 96) return true
  return false
}

export function isDarkSurfaceCss(surfaceCss: string | null): boolean {
  if (!surfaceCss) return false
  return isDarkDecorativeBackground(surfaceCss)
}

/** Parse SVG/CSS fill into a comparable color string, or null if none/url/gradient. */
export function parsePaintColor(paint: string | null | undefined): string | null {
  if (!paint) return null
  const s = paint.trim().toLowerCase()
  if (!s || s === 'none' || s === 'transparent') return null
  if (s === 'currentcolor') return 'currentColor'
  if (/url\(/i.test(s)) return null
  if (isDarkDecorativeBackground(s) || !isTransparentCssColor(s)) return s
  const rgb = parseCssColor(s)
  if (!rgb) return null
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}

export function isDarkPaint(paint: string | null | undefined, currentColorCss?: string): boolean {
  if (!paint) return false
  if (paint === 'currentColor') {
    return currentColorCss ? isDarkDecorativeBackground(currentColorCss) : true
  }
  return isDarkDecorativeBackground(paint)
}

export type DomRectLike = { left: number; top: number; right: number; bottom: number; width: number; height: number }

export function rectsOverlap(a: DomRectLike, b: DomRectLike, minCoverage = 0.35): boolean {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const overlap = x * y
  if (overlap <= 0) return false
  const base = Math.max(1, Math.min(a.width * a.height, b.width * b.height))
  return overlap / base >= minCoverage
}

/** True when two CSS colors are perceptually close (theme-fg vs path fill). */
export function colorsClose(a: string, b: string, maxChannelDelta = 28): boolean {
  const pa = parseCssColor(a)
  const pb = parseCssColor(b)
  if (!pa || !pb) return false
  return (
    Math.abs(pa.r - pb.r) <= maxChannelDelta &&
    Math.abs(pa.g - pb.g) <= maxChannelDelta &&
    Math.abs(pa.b - pb.b) <= maxChannelDelta
  )
}

function shapeFillPaint(shape: Element): string | null {
  const fillAttr = shape.getAttribute('fill')
  let fillCs: string | null = null
  try {
    fillCs = shape.ownerDocument.defaultView?.getComputedStyle(shape as Element).fill ?? null
  } catch {
    fillCs = null
  }
  const paint = parsePaintColor(fillAttr) || parsePaintColor(fillCs || undefined)
  if (!paint || paint === 'none') return null
  return paint
}

/**
 * Point (svg user units) sits on a dark filled shape other than `exclude`.
 * Title capsules are usually rect/path; bbox fallback covers rx pills.
 */
export function svgPointOnDarkShape(
  svg: SVGSVGElement,
  cx: number,
  cy: number,
  currentColor: string,
  exclude?: Element | null,
): boolean {
  const shapes = svg.querySelectorAll('rect, path, circle, ellipse, polygon, polyline')
  for (const shape of shapes) {
    if (exclude && shape === exclude) continue
    if (!isSvgGeometryElement(shape)) continue
    const paint = shapeFillPaint(shape)
    if (!paint) continue
    if (!isDarkPaint(paint, currentColor)) continue
    try {
      const pt = svg.createSVGPoint()
      pt.x = cx
      pt.y = cy
      if (typeof shape.isPointInFill === 'function' && shape.isPointInFill(pt)) return true
    } catch {
      /* */
    }
    try {
      const sb = shape.getBBox()
      if (cx >= sb.x && cx <= sb.x + sb.width && cy >= sb.y && cy <= sb.y + sb.height) return true
    } catch {
      /* */
    }
  }
  return false
}

/**
 * Decide fill for an SVG <text>: light when its anchor sits on a dark shape,
 * otherwise theme foreground (for labels on white diagram areas).
 */
export function resolveSvgTextFill(opts: {
  textEl: SVGTextElement
  light: string
  dark: string
  currentColor: string
  titleBands?: SvgBand[]
}): string {
  const { textEl, light, dark, currentColor, titleBands } = opts
  const svg = textEl.ownerSVGElement
  if (!svg) return dark

  let cx = 0
  let cy = 0
  try {
    const b = textEl.getBBox()
    // Unlaid-out text on PC often reports empty bbox — fall back to x/y attrs.
    if (b.width < 0.5 && b.height < 0.5) {
      const x = Number(textEl.getAttribute('x') || 0)
      const y = Number(textEl.getAttribute('y') || 0)
      cx = x
      cy = y
    } else {
      cx = b.x + b.width / 2
      cy = b.y + b.height / 2
    }
  } catch {
    cx = Number(textEl.getAttribute('x') || 0)
    cy = Number(textEl.getAttribute('y') || 0)
  }

  if (titleBands?.length && pointInSvgBands(cx, cy, titleBands)) return light
  return svgPointOnDarkShape(svg, cx, cy, currentColor, textEl) ? light : dark
}

/**
 * Illustrator/CN EPUB diagrams often draw titles as <path> glyphs — not <text>.
 * Any dark fill on a *small* shape sitting in a title band / on a larger dark
 * backdrop must go white. Do NOT require theme/currentColor: publisher often
 * uses fill="#000" / "#222" for glyphs (neutral grey AA in screenshots).
 */
export function shouldLightenSvgGlyphShape(opts: {
  shape: SVGGeometryElement
  light: string
  dark: string
  currentColor: string
  themeFg: string
  titleBands?: SvgBand[]
}): string | null {
  const { shape, light, currentColor, titleBands } = opts
  const svg = shape.ownerSVGElement
  if (!svg) return null

  const fillAttr = shape.getAttribute('fill')
  let fillCs: string | null = null
  try {
    fillCs = shape.ownerDocument.defaultView?.getComputedStyle(shape).fill ?? null
  } catch {
    fillCs = null
  }
  const raw = parsePaintColor(fillAttr) || parsePaintColor(fillCs || undefined)
  if (!raw || raw === 'none') return null
  // Light/white fills are already fine (end-caps, white circles).
  if (!isDarkPaint(raw, currentColor)) return null

  let cx = 0
  let cy = 0
  let bw = 0
  let bh = 0
  try {
    const b = shape.getBBox()
    cx = b.x + b.width / 2
    cy = b.y + b.height / 2
    bw = b.width
    bh = b.height
  } catch {
    return null
  }

  // Skip huge backdrop shapes (the black capsule itself).
  let sw = 0
  let sh = 0
  try {
    const vb = svg.viewBox?.baseVal
    if (vb && vb.width > 0) {
      sw = vb.width
      sh = vb.height
    } else {
      const sb = svg.getBBox()
      sw = sb.width
      sh = sb.height
    }
  } catch {
    /* */
  }
  if (sw > 0 && bw * bh > sw * sh * 0.08) return null
  // Glyphs are small relative to the title bar; skip mid-size decorations.
  if (sw > 0 && bw > sw * 0.5 && bh > sh * 0.08) return null

  if (titleBands?.length && pointInSvgBands(cx, cy, titleBands)) return light
  if (!svgPointOnDarkShape(svg, cx, cy, currentColor, shape)) return null
  return light
}

/**
 * Thin full-bleed black lines under chapter titles (「第二章」) are NOT title capsules.
 * Treating them as dark backdrops forced white text onto cream page bg.
 */
export function isThinDecorativeRule(r: DomRectLike, textHeight = 0): boolean {
  if (r.height < 1 || r.width < 1) return true
  if (r.height <= 12) return true
  if (textHeight > 0 && r.height < textHeight * 0.45 && r.width > r.height * 8) return true
  if (r.width > r.height * 12 && r.height < 20) return true
  return false
}

/**
 * Media that sits next to a caption — not "any img later in the chapter".
 * Parent.querySelector('img') falsely whitened every short title in the section.
 */
export function hasAdjacentFigureMedia(el: Element): boolean {
  const check = (sib: Element | null) => {
    if (!sib) return false
    const tag = sib.tagName.toLowerCase()
    if (tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'object') return true
    if (sib.querySelector(':scope > img, :scope > svg, :scope > picture, :scope > object')) return true
    return false
  }
  return check(el.previousElementSibling) || check(el.nextElementSibling)
}

/**
 * HTML title sitting on a sibling/absolute dark pill (common CN EPUB pattern):
 *   <div style="position:relative">
 *     <div style="position:absolute;background:#000"></div>
 *     <p>朱重八家族</p>
 *   </div>
 * Own background is transparent → older wash kept theme-dark text.
 * Also: title over a sibling <img> black bar (sample pixels when possible).
 */
export function elementOverlapsDarkBackdrop(el: HTMLElement, win: Window): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false

  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const textH = rect.height

  const imgDarkAt = (img: HTMLImageElement): boolean => {
    try {
      const r = img.getBoundingClientRect()
      if (isThinDecorativeRule(r, textH)) return false
      if (r.width < 1 || r.height < 1 || !img.naturalWidth) {
        // Overlapping an image with a short label — treat as dark bar candidate
        // only when tall enough to be a capsule, not a 1px rule bitmap.
        return r.height >= Math.max(16, textH * 0.5)
      }
      const canvas = el.ownerDocument.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      if (!ctx) return true
      const nx = ((cx - r.left) / r.width) * img.naturalWidth
      const ny = ((cy - r.top) / r.height) * img.naturalHeight
      ctx.drawImage(img, nx, ny, 1, 1, 0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return relativeLuminance(d[0], d[1], d[2]) < 0.42
    } catch {
      return true
    }
  }

  let node: HTMLElement | null = el
  for (let depth = 0; depth < 8 && node; depth++) {
    const parent = node.parentElement
    if (!parent || parent === el.ownerDocument.body) break

    for (const sib of Array.from(parent.children)) {
      if (!isHtmlElement(sib) || sib === node) continue
      const tag = sib.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'br' || tag === 'hr') continue

      if (tag === 'img') {
        const img = sib as HTMLImageElement
        const sr = img.getBoundingClientRect()
        if (isThinDecorativeRule(sr, textH)) continue
        if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) {
          if (imgDarkAt(img)) return true
        } else if (rectsOverlap(rect, sr, 0.35) && imgDarkAt(img)) {
          return true
        }
        continue
      }

      // SVG sibling: hit-test dark shapes in svg user space via screen bbox of svg.
      if (tag === 'svg' && isSvgSvgElement(sib)) {
        const sr = sib.getBoundingClientRect()
        if (isThinDecorativeRule(sr, textH)) continue
        if (!rectsOverlap(rect, sr, 0.15)) continue
        try {
          const vb = sib.viewBox?.baseVal
          const sb = vb && vb.width ? vb : null
          let ux = cx - sr.left
          let uy = cy - sr.top
          if (sb && sr.width > 0 && sr.height > 0) {
            ux = sb.x + ((cx - sr.left) / sr.width) * sb.width
            uy = sb.y + ((cy - sr.top) / sr.height) * sb.height
          }
          const bands = collectSvgTitleBands(sib, win.getComputedStyle(el.ownerDocument.body).color || '#000')
          if (pointInSvgBands(ux, uy, bands)) return true
          if (svgPointOnDarkShape(sib, ux, uy, win.getComputedStyle(el.ownerDocument.body).color || '#000')) {
            return true
          }
        } catch {
          /* */
        }
        continue
      }

      let cs: CSSStyleDeclaration
      try {
        cs = win.getComputedStyle(sib)
      } catch {
        continue
      }
      const surface = resolveSurfaceBackgroundCss(sib, cs, win, { ignorePseudos: true })
      if (!isDarkSurfaceCss(surface)) continue
      const sr = sib.getBoundingClientRect()
      if (sr.width < 1 || sr.height < 1) continue
      // Chapter title rules: full-width 1–3px black lines — ignore.
      if (isThinDecorativeRule(sr, textH)) continue
      // Real title capsules are at least ~half the text height.
      if (sr.height < Math.max(16, textH * 0.5)) continue
      // Center of title over dark layer is enough (pill often wider than text).
      if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) return true
      if (rectsOverlap(rect, sr, 0.4)) return true
    }
    node = parent
  }
  return false
}

function ownShortLabelText(el: HTMLElement): string {
  let own = ''
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) own += n.textContent || ''
  }
  own = own.replace(/\s+/g, '').trim()
  if (own) return own
  if (el.children.length === 0) return (el.textContent || '').replace(/\s+/g, '').trim()
  return ''
}

/**
 * Single source of truth: is this short label sitting on a dark capsule?
 * Own solid / full-bleed url / sibling overlap / glyph-center probe (SVG/img/HTML).
 * Never treats html/body, thin rules, or ◆ ::before bullets as dark capsules.
 *
 * CRITICAL (明朝 p_title): white/cream background-color + url(blob) black capsule.
 * Hiding the element for elementsFromPoint also hides that url — must detect via
 * background-image before probing.
 */
export function shortLabelBackdropIsDark(
  doc: Document,
  win: Window,
  node: HTMLElement,
  themeFg: string,
): boolean {
  let cs: CSSStyleDeclaration
  try {
    cs = win.getComputedStyle(node)
  } catch {
    return false
  }
  const rect = node.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false

  // url(...) title bars first — own solid is often light (white plate under capsule art).
  if (urlBackgroundLikelyTitleBar(cs, rect)) return true

  const solid = resolveSurfaceBackgroundCss(node, cs, win, { ignorePseudos: true })
  if (isDarkSurfaceCss(solid)) return true
  if (elementOverlapsDarkBackdrop(node, win)) return true

  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const prev = node.style.getPropertyValue('visibility')
  const prevPri = node.style.getPropertyPriority('visibility')
  node.style.setProperty('visibility', 'hidden', 'important')
  let dark = false
  try {
    dark = pointHasDarkBackdrop(doc, win, node, cx, cy, rect.height, themeFg)
  } catch {
    dark = false
  }
  if (prev) node.style.setProperty('visibility', prev, prevPri || undefined)
  else node.style.removeProperty('visibility')
  return dark
}

/**
 * ONE definitive pass for short HTML labels:
 * dark backdrop → pure white + qyOnDark; else → themeFg and clear qyOnDark.
 * Replaces the old forceShortLabels ↔ reconcile fight.
 */
export function applyShortLabelContrast(
  doc: Document,
  themeFg: string,
): { whitened: number; restored: number } {
  const win = doc.defaultView
  const body = doc.body
  if (!win || !body) return { whitened: 0, restored: 0 }

  const WHITE = LIGHT_ON_DARK_FG
  let whitened = 0
  let restored = 0

  const paint = (el: HTMLElement, onDark: boolean) => {
    const color = onDark ? WHITE : themeFg
    el.style.setProperty('color', color, 'important')
    el.style.setProperty('-webkit-text-fill-color', color, 'important')
    el.style.setProperty('opacity', '1', 'important')
    if (onDark) {
      el.dataset.qyOnDark = '1'
      whitened++
    } else {
      delete el.dataset.qyOnDark
      restored++
    }
  }

  const candidates = body.querySelectorAll(
    'p, div, span, h1, h2, h3, h4, h5, h6, label, figcaption, caption, center, font, a, strong, em, b, li, td, th',
  )

  candidates.forEach((node) => {
    if (!isHtmlElement(node)) return
    if (node.closest('svg')) return
    const text = ownShortLabelText(node)
    if (!text || text.length > 24) return

    const onDark = shortLabelBackdropIsDark(doc, win, node, themeFg)
    paint(node, onDark)
  })

  return { whitened, restored }
}

/**
 * @deprecated Use applyShortLabelContrast. Kept as thin wrapper for SVG retry timers.
 */
export function forceShortLabelsOnDarkBackdrop(doc: Document, themeFg: string): number {
  return applyShortLabelContrast(doc, themeFg).whitened
}

/**
 * @deprecated Use applyShortLabelContrast. Kept for older selftests.
 */
export function reconcileOnDarkLabels(doc: Document, themeFg: string): number {
  return applyShortLabelContrast(doc, themeFg).restored
}

/**
 * True when the glyph center sits on a dark layer (HTML pill / img / SVG capsule).
 * Uses elementsFromPoint so cream plates above/under the black bar do not hide it.
 */
export function pointHasDarkBackdrop(
  doc: Document,
  win: Window,
  node: HTMLElement,
  cx: number,
  cy: number,
  textH: number,
  themeFg: string,
): boolean {
  let stack: Element[] = []
  try {
    if (typeof doc.elementsFromPoint === 'function') {
      stack = doc.elementsFromPoint(cx, cy)
    } else {
      const one = doc.elementFromPoint(cx, cy)
      if (one) stack = [one]
    }
  } catch {
    stack = []
  }

  const consider = (el: Element | null): boolean => {
    if (!el || el === node) return false
    const tag = el.tagName.toLowerCase()
    // Page canvas is never a "title capsule" — treating html/body as dark
    // kept ◆ cream heads white whenever the shell theme painted html dark.
    if (tag === 'html' || tag === 'body') return false
    if (tag === 'hr' || tag === 'br' || tag === 'script' || tag === 'style') return false

    if (tag === 'img') {
      try {
        const img = el as HTMLImageElement
        const r = img.getBoundingClientRect()
        if (isThinDecorativeRule(r, textH)) return false
        if (r.height < Math.max(16, textH * 0.5)) return false
        if (!img.naturalWidth) return true
        const canvas = doc.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d')
        if (!ctx) return true
        const nx = ((cx - r.left) / r.width) * img.naturalWidth
        const ny = ((cy - r.top) / r.height) * img.naturalHeight
        ctx.drawImage(img, nx, ny, 1, 1, 0, 0, 1, 1)
        const d = ctx.getImageData(0, 0, 1, 1).data
        return relativeLuminance(d[0], d[1], d[2]) < 0.42
      } catch {
        return true
      }
    }

    if (isSvgSvgElement(el) || (el.namespaceURI === 'http://www.w3.org/2000/svg' && (el as SVGElement).ownerSVGElement)) {
      const svg = isSvgSvgElement(el) ? el : (el as SVGElement).ownerSVGElement!
      if (!svg) return false
      try {
        const sr = svg.getBoundingClientRect()
        if (isThinDecorativeRule(sr, textH)) return false
        const vb = svg.viewBox?.baseVal
        let ux = cx - sr.left
        let uy = cy - sr.top
        if (vb && vb.width && sr.width > 0 && sr.height > 0) {
          ux = vb.x + ((cx - sr.left) / sr.width) * vb.width
          uy = vb.y + ((cy - sr.top) / sr.height) * vb.height
        }
        const bands = collectSvgTitleBands(svg, themeFg)
        if (pointInSvgBands(ux, uy, bands) || svgPointOnDarkShape(svg, ux, uy, themeFg)) return true
      } catch {
        return false
      }
      return false
    }

    if (isHtmlElement(el)) {
      try {
        const br = el.getBoundingClientRect()
        if (isThinDecorativeRule(br, textH)) return false
        const ecs = win.getComputedStyle(el)
        const s = resolveSurfaceBackgroundCss(el, ecs, win, { ignorePseudos: true })
        if (isDarkSurfaceCss(s) && br.height >= Math.max(16, textH * 0.5)) return true
        if (urlBackgroundLikelyTitleBar(ecs, br)) return true
      } catch {
        /* */
      }
    }
    return false
  }

  for (const el of stack) {
    if (el === node) continue
    // Walk a short ancestor chain from each hit (cream wrapper may be topmost).
    let cur: Element | null = el
    for (let i = 0; i < 5 && cur; i++) {
      if (consider(cur)) return true
      cur = cur.parentElement
    }
  }
  return false
}

