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
