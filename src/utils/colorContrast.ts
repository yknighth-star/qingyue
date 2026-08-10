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
 * Pick readable text on a solid surface.
 * Dark decorative bars (figure titles) keep light glyphs; light surfaces use theme fg.
 * Returns null when surface is transparent — caller should inherit.
 */
export function contrastTextForBackground(
  backgroundCss: string,
  themeFg: string,
  themeBg: string,
): string | null {
  if (isTransparentCssColor(backgroundCss)) return null
  const rgb = parseCssColor(backgroundCss)
  if (!rgb) return themeFg
  const L = relativeLuminance(rgb.r, rgb.g, rgb.b)
  // Dark pill / caption bars (e.g. 明朝那些事儿 figure titles)
  if (L < 0.42) {
    const bgRgb = parseCssColor(themeBg)
    const bgL = bgRgb ? relativeLuminance(bgRgb.r, bgRgb.g, bgRgb.b) : 1
    // On light reader themes, themeBg is a readable off-white on black.
    return bgL > 0.55 ? themeBg : '#f4f1ea'
  }
  return themeFg
}

/** True when a solid background is dark enough to keep (decorative), not wash away. */
export function isDarkDecorativeBackground(backgroundCss: string): boolean {
  if (isTransparentCssColor(backgroundCss)) return false
  const rgb = parseCssColor(backgroundCss)
  if (!rgb) return false
  return relativeLuminance(rgb.r, rgb.g, rgb.b) < 0.42
}

const TITLE_CLASS_RE =
  /caption|fuming|img-title|image-title|pic-title|tu-ti|title|biaoti|btitle|chapter-title|kindle-cn/i

/** Figure/section title bars that commonly sit on black pills in CN EPUBs. */
export function isFigureTitleLike(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'figcaption' || tag === 'caption' || tag === 'cite') return true
  const cls = (el instanceof HTMLElement ? el.className : '') || ''
  if (typeof cls === 'string' && TITLE_CLASS_RE.test(cls)) return true
  const id = el.id || ''
  if (TITLE_CLASS_RE.test(id)) return true
  // Short centered heading-like blocks (e.g. 「赈灾物品」)
  if (el instanceof HTMLElement) {
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
 * Prefers opaque background-color; falls back to dark gradient stops / bgcolor attr /
 * ::before/::after solid fills (common CN EPUB title bars).
 */
export function resolveSurfaceBackgroundCss(
  el: HTMLElement,
  cs: CSSStyleDeclaration,
  win?: Window | null,
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
  // Any opaque gradient stop counts as a surface hint.
  for (const c of fromGrad) {
    if (!isTransparentCssColor(c)) return c
  }

  if (win) {
    for (const pseudo of ['::before', '::after'] as const) {
      try {
        const pcs = win.getComputedStyle(el, pseudo)
        if (!pcs || pcs.content === 'none' || pcs.content === 'normal') continue
        const pbg = pcs.backgroundColor
        if (!isTransparentCssColor(pbg)) return pbg
        for (const c of colorsFromBackgroundImage(pcs.backgroundImage)) {
          if (isDarkDecorativeBackground(c)) return c
        }
      } catch {
        /* */
      }
    }
  }

  return null
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
    if (!(shape instanceof SVGGeometryElement)) continue
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
}): string {
  const { textEl, light, dark, currentColor } = opts
  const svg = textEl.ownerSVGElement
  if (!svg) return dark

  let cx = 0
  let cy = 0
  try {
    const b = textEl.getBBox()
    cx = b.x + b.width / 2
    cy = b.y + b.height / 2
  } catch {
    return dark
  }

  return svgPointOnDarkShape(svg, cx, cy, currentColor, textEl) ? light : dark
}

/**
 * Illustrator/CN EPUB diagrams often draw titles as <path> glyphs with
 * fill=currentColor / theme fg — not <text>. Lighten only theme-driven dark
 * fills that sit on a *different* dark backdrop (leave the black bar itself).
 */
export function shouldLightenSvgGlyphShape(opts: {
  shape: SVGGeometryElement
  light: string
  dark: string
  currentColor: string
  themeFg: string
}): string | null {
  const { shape, light, currentColor, themeFg } = opts
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

  // Black decorative bars use solid #000 — do not invert them.
  // Glyphs use currentColor or a fill ≈ theme foreground.
  const themeDriven =
    raw === 'currentColor' ||
    colorsClose(raw === 'currentColor' ? currentColor : raw, themeFg) ||
    colorsClose(raw === 'currentColor' ? currentColor : raw, currentColor)
  if (!themeDriven) return null
  if (!isDarkPaint(raw, currentColor) && !isDarkDecorativeBackground(currentColor)) return null

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
  // Skip huge backdrop shapes (the black capsule itself if somehow theme-colored).
  try {
    const vb = svg.viewBox?.baseVal
    const sw = vb && vb.width ? vb.width : svg.getBBox().width
    if (sw > 0 && bw * bh > sw * sw * 0.12) return null
  } catch {
    /* */
  }

  if (!svgPointOnDarkShape(svg, cx, cy, currentColor, shape)) return null
  return light
}

/**
 * HTML title sitting on a sibling/absolute dark pill (common CN EPUB pattern):
 *   <div style="position:relative">
 *     <div style="position:absolute;background:#000"></div>
 *     <p>朱重八家族</p>
 *   </div>
 * Own background is transparent → older wash kept theme-dark text.
 */
export function elementOverlapsDarkBackdrop(el: HTMLElement, win: Window): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false

  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  let node: HTMLElement | null = el
  for (let depth = 0; depth < 8 && node; depth++) {
    const parent = node.parentElement
    if (!parent || parent === el.ownerDocument.body) break

    for (const sib of Array.from(parent.children)) {
      if (!(sib instanceof HTMLElement) || sib === node) continue
      const tag = sib.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'br') continue

      // SVG sibling: hit-test dark shapes in svg user space via screen bbox of svg.
      if (tag === 'svg' && sib instanceof SVGSVGElement) {
        const sr = sib.getBoundingClientRect()
        if (!rectsOverlap(rect, sr, 0.15)) continue
        // Map title center into svg client coords roughly via bounding box ratio.
        try {
          const vb = sib.viewBox?.baseVal
          const sb = vb && vb.width ? vb : null
          let ux = cx - sr.left
          let uy = cy - sr.top
          if (sb && sr.width > 0 && sr.height > 0) {
            ux = sb.x + ((cx - sr.left) / sr.width) * sb.width
            uy = sb.y + ((cy - sr.top) / sr.height) * sb.height
          }
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
      const surface = resolveSurfaceBackgroundCss(sib, cs, win)
      if (!isDarkSurfaceCss(surface)) continue
      const sr = sib.getBoundingClientRect()
      if (sr.width < 1 || sr.height < 1) continue
      // Center of title over dark layer is enough (pill often wider than text).
      if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) return true
      if (rectsOverlap(rect, sr, 0.4)) return true
    }
    node = parent
  }
  return false
}

