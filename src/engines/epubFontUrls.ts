import type { Book } from 'epubjs'

const FONT_EXT_RE = /\.(ttf|otf|woff2?|ttc)([?#].*)?$/i
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
/** Neutralize unresolved relative font urls so Chrome won't hit about:srcdoc / blob-relative. */
const MISSING_FONT = 'local("__qingyue_font_missing__")'

type ZipArchive = {
  zip?: {
    files: Record<string, { dir?: boolean }>
    file: (path: string) => { async: (type: string) => Promise<Uint8Array> } | null
  }
}

type ResourcesLike = {
  urls?: string[]
  cssUrls?: string[]
  replacementUrls?: Array<string | null | undefined>
}

/**
 * Before first display: rewrite font urls inside epub.js-generated CSS blobs.
 * Relative urls inside blob: CSS resolve against the blob id and Chrome blocks them.
 */
export async function remapBookCssFonts(book: Book, cache: Map<string, string>): Promise<void> {
  const resources = book.resources as unknown as ResourcesLike | undefined
  if (!resources?.urls?.length || !resources.replacementUrls?.length) return

  for (let i = 0; i < resources.urls.length; i++) {
    const href = resources.urls[i]
    const current = resources.replacementUrls[i]
    if (!href || !current || !String(current).startsWith('blob:')) continue
    if (!/\.css($|\?)/i.test(href) && !resources.cssUrls?.includes(href)) continue
    try {
      const text = await fetch(String(current)).then((r) => r.text())
      if (!containsRelativeFontUrl(text)) continue
      const next = await rewriteCssText(text, book, cache, href)
      if (next === text) continue
      const fresh = URL.createObjectURL(new Blob([next], { type: 'text/css' }))
      resources.replacementUrls[i] = fresh
      cache.set(`css-blob:${href}`, fresh)
    } catch {
      /* */
    }
  }
}

/** Rewrite inline + linked CSS in an already-mounted chapter document. */
export async function rewriteEpubFontUrls(
  doc: Document,
  book: Book,
  cache: Map<string, string>,
): Promise<void> {
  const baseHref =
    doc.querySelector('base')?.getAttribute('href') ||
    (typeof doc.baseURI === 'string' ? doc.baseURI : '') ||
    ''

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const raw = style.textContent || ''
    if (!containsRelativeFontUrl(raw) && !FONT_EXT_RE.test(raw)) continue
    const next = await rewriteCssText(raw, book, cache, baseHref)
    if (next !== raw) style.textContent = next
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = (link as HTMLLinkElement).href
    if (!href || !(href.startsWith('blob:') || href.startsWith('data:'))) continue
    try {
      const text = await fetch(href).then((r) => r.text())
      if (!containsRelativeFontUrl(text) && !FONT_EXT_RE.test(text)) continue
      const next = neutralizeRelativeFonts(await rewriteCssText(text, book, cache, href))
      const style = doc.createElement('style')
      style.setAttribute('data-qy-font-fix', '1')
      style.textContent = next
      link.replaceWith(style)
    } catch {
      /* */
    }
  }
}

/** Mutate serialized chapter HTML before it is written into srcdoc. */
export async function rewriteHtmlFontUrls(
  html: string,
  book: Book,
  cache: Map<string, string>,
): Promise<string> {
  if (!html || (!containsRelativeFontUrl(html) && !FONT_EXT_RE.test(html))) return html
  // Inline <style> blocks
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  const parts: Array<Promise<void>> = []
  let out = html
  const styles: Array<{ full: string; css: string }> = []
  for (const m of html.matchAll(styleRe)) {
    styles.push({ full: m[0], css: m[1] || '' })
  }
  const replaced = new Map<string, string>()
  for (const s of styles) {
    parts.push(
      rewriteCssText(s.css, book, cache).then((next) => {
        if (next !== s.css) {
          replaced.set(s.full, s.full.replace(s.css, next))
        }
      }),
    )
  }
  await Promise.all(parts)
  for (const [full, next] of replaced) {
    out = out.split(full).join(next)
  }
  return neutralizeRelativeFonts(out)
}

export async function rewriteCssText(
  css: string,
  book: Book,
  cache: Map<string, string>,
  baseHref = '',
): Promise<string> {
  if (!css || !FONT_EXT_RE.test(css)) return css
  const matches = Array.from(css.matchAll(URL_RE))
  if (!matches.length) return css

  let out = css
  const unique = [...new Set(matches.map((m) => m[0]))].sort((a, b) => b.length - a.length)
  for (const full of unique) {
    const inner = full.replace(/^url\(\s*['"]?|['"]?\s*\)$/gi, '').trim()
    if (!FONT_EXT_RE.test(inner)) continue
    if (/^(blob:|data:)/i.test(inner)) continue
    if (/^https?:/i.test(inner)) continue

    const blob = await resolveFontBlob(inner, book, cache, baseHref)
    out = out.split(full).join(blob ? `url("${blob}")` : MISSING_FONT)
  }
  return neutralizeRelativeFonts(out)
}

function containsRelativeFontUrl(text: string): boolean {
  return /url\(\s*['"]?(?!blob:|data:|https?:|local\()[^'")]*\.(ttf|otf|woff2?|ttc)/i.test(text)
}

function neutralizeRelativeFonts(text: string): string {
  if (!containsRelativeFontUrl(text)) return text
  return text.replace(URL_RE, (full, _q: string, inner: string) => {
    const ref = String(inner || '').trim()
    if (!FONT_EXT_RE.test(ref)) return full
    if (/^(blob:|data:|https?:)/i.test(ref)) return full
    return MISSING_FONT
  })
}

async function resolveFontBlob(
  ref: string,
  book: Book,
  cache: Map<string, string>,
  baseHref: string,
): Promise<string | null> {
  const cleaned = ref.trim().replace(/^["']|["']$/g, '')
  if (!cleaned || !FONT_EXT_RE.test(cleaned)) return null
  if (/^(blob:|data:)/i.test(cleaned)) return cleaned

  const cached = cache.get(cleaned) || cache.get(cleaned.split(/[/\\]/).pop()!.toLowerCase())
  if (cached) return cached

  const archive = book.archive as unknown as ZipArchive | null | undefined
  if (!archive?.zip) return null

  const candidates = buildZipCandidates(cleaned, baseHref, book)
  for (const path of candidates) {
    const url = await blobUrlFromZip(archive, path, cache)
    if (url) {
      cache.set(cleaned, url)
      return url
    }
  }

  const baseName = cleaned.split(/[/\\]/).pop() || ''
  const byName = findZipPathByBasename(archive, baseName)
  if (byName) {
    const url = await blobUrlFromZip(archive, byName, cache)
    if (url) {
      cache.set(cleaned, url)
      return url
    }
  }
  return null
}

function buildZipCandidates(ref: string, baseHref: string, book: Book): string[] {
  const out: string[] = []
  const push = (p: string | undefined | null) => {
    if (!p) return
    let s = p.trim()
    try {
      if (/^https?:\/\//i.test(s)) s = new URL(s).pathname
    } catch {
      /* */
    }
    s = decodeURIComponent(s.split(/[?#]/)[0] || '').replace(/\\/g, '/')
    if (!s) return
    const noSlash = s.replace(/^\//, '')
    if (noSlash && !out.includes(noSlash)) out.push(noSlash)
  }

  push(ref)
  push(ref.replace(/^\.\//, ''))
  try {
    push(book.resolve(ref, false))
  } catch {
    /* */
  }
  try {
    if (baseHref) push(new URL(ref, baseHref).pathname)
  } catch {
    /* */
  }
  // Resolve against css path directory when baseHref looks like a package path
  if (baseHref && !/^blob:|https?:/i.test(baseHref)) {
    const dir = baseHref.replace(/^\//, '').replace(/[^/]+$/, '')
    push(dir + ref.replace(/^\.\//, ''))
  }
  return out
}

async function blobUrlFromZip(
  archive: ZipArchive,
  zipPath: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const path = zipPath.replace(/^\//, '')
  if (!path || !archive.zip) return null
  const cacheKey = `zip:${path.toLowerCase()}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const entry =
    archive.zip.file(path) ||
    archive.zip.file(decodeURIComponent(path)) ||
    null
  if (!entry) return null

  try {
    const buf = await entry.async('uint8array')
    const copy = new Uint8Array(buf.byteLength)
    copy.set(buf)
    const lower = path.toLowerCase()
    const mime = lower.endsWith('.woff2')
      ? 'font/woff2'
      : lower.endsWith('.woff')
        ? 'font/woff'
        : lower.endsWith('.otf')
          ? 'font/otf'
          : 'font/ttf'
    const url = URL.createObjectURL(new Blob([copy], { type: mime }))
    cache.set(cacheKey, url)
    const base = path.split('/').pop()?.toLowerCase()
    if (base) cache.set(base, url)
    return url
  } catch {
    return null
  }
}

function findZipPathByBasename(archive: ZipArchive, baseName: string): string | null {
  if (!baseName || !archive.zip?.files) return null
  const lower = baseName.toLowerCase()
  const hits = Object.keys(archive.zip.files).filter((p) => {
    const entry = archive.zip!.files[p]
    if (entry?.dir) return false
    return p.split('/').pop()?.toLowerCase() === lower
  })
  // Prefer paths that look like font folders
  hits.sort((a, b) => {
    const score = (p: string) =>
      /font/i.test(p) ? 0 : /css|style/i.test(p) ? 1 : 2
    return score(a) - score(b) || a.length - b.length
  })
  return hits[0] || null
}

export function revokeFontUrlCache(cache: Map<string, string>) {
  const revoke = URL.revokeObjectURL.bind(URL)
  for (const url of cache.values()) {
    if (url.startsWith('blob:')) {
      try {
        revoke(url)
      } catch {
        /* */
      }
    }
  }
  cache.clear()
}
