import JSZip from 'jszip'
import type { BookFormat } from '@/types'
import { normalizeAuthor } from '@/utils/author'
import { sanitizeMetaTitle } from '@/utils/bookMeta'
import { PDF_WORKER_SRC } from '@/utils/pdfWorker'

export interface MetaResult {
  title?: string
  author?: string
  cover?: Blob
}

/** quick = title/author only (import); full = + cover (idle backfill / repair). */
export type MetaExtractMode = 'quick' | 'full'

export async function extractCoverAndMeta(
  file: Blob,
  format: BookFormat,
  opts?: { mode?: MetaExtractMode },
): Promise<MetaResult> {
  const mode = opts?.mode ?? 'full'
  try {
    if (format === 'epub') return await extractEpubMeta(file, mode)
    if (format === 'pdf') return await extractPdfMeta(file, mode)
    if (format === 'txt') return await extractTxtMeta(file, mode)
  } catch (err) {
    console.warn('Cover/meta extract failed', format, err)
  }
  return {}
}

async function extractTxtMeta(file: Blob, mode: MetaExtractMode): Promise<MetaResult> {
  // Peek first lines for a rough title; cover is a generated title card (full only)
  let hint = ''
  try {
    const sample = (await file.slice(0, 2048).text()).replace(/^\uFEFF/, '')
    const line = sample
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length >= 2 && l.length <= 40)
    if (line) hint = line
  } catch {
    /* */
  }
  if (mode === 'quick') return { title: undefined, author: undefined }
  const cover = await renderTitleCover(hint || 'TXT')
  return { title: undefined, author: undefined, cover }
}

async function extractPdfMeta(file: Blob, mode: MetaExtractMode): Promise<MetaResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC
  // Blob URL avoids an extra ArrayBuffer copy of the whole PDF on the JS heap.
  const url = URL.createObjectURL(file)
  let pdf: import('pdfjs-dist').PDFDocumentProxy | null = null
  try {
    pdf = await pdfjs.getDocument({
      url,
      // Cover/meta only needs page 1 + info dict; allow stream so worker can start early.
      disableAutoFetch: mode === 'quick',
      disableStream: false,
    }).promise
    let title: string | undefined
    let author: string | undefined
    try {
      const meta = await pdf.getMetadata()
      const info = meta?.info as { Title?: string; Author?: string } | undefined
      title = sanitizeMetaTitle(info?.Title)
      author = normalizeAuthor(info?.Author) || undefined
    } catch {
      /* metadata optional */
    }

    if (mode === 'quick') return { title, author }

    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    // Smaller cover on phone-class viewports; desktop can afford a bit more detail.
    const phone = typeof window !== 'undefined' && window.innerWidth < 768
    const targetW = phone ? 160 : 220
    const scale = Math.min(phone ? 1.25 : 1.6, targetW / Math.max(1, base.width))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return { title, author }
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({
      canvasContext: ctx,
      viewport,
      background: 'rgb(255,255,255)',
      intent: 'display',
    }).promise

    const cover = await canvasToBlob(canvas, 'image/jpeg', phone ? 0.72 : 0.8)
    canvas.width = 0
    canvas.height = 0
    return { title, author, cover }
  } finally {
    URL.revokeObjectURL(url)
    try {
      await pdf?.destroy()
    } catch {
      /* */
    }
  }
}

async function extractEpubMeta(file: Blob, mode: MetaExtractMode): Promise<MetaResult> {
  const zip = await JSZip.loadAsync(file)
  const container = await zipReadText(zip, 'META-INF/container.xml')
  if (!container) return {}
  const opfPath = container.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!opfPath) return {}
  const opf = await zipReadText(zip, opfPath)
  if (!opf) return {}

  const title = sanitizeMetaTitle(opf.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)?.[1])
  const author =
    normalizeAuthor(opf.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)?.[1]) || undefined

  if (mode === 'quick') return { title, author }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const items = parseManifestItems(opf)
  const coverHref = resolveEpubCoverHref(opf, items)
  let cover: Blob | undefined
  if (coverHref) {
    cover = await loadZipImage(zip, resolveZipPath(opfDir, coverHref))
  }
  if (!cover) {
    // Last resort: first reasonably sized image in the package
    cover = await findFirstManifestImage(zip, opfDir, items)
  }
  return { title, author, cover }
}

export type ManifestItem = {
  id: string
  href: string
  mediaType: string
  properties: string
}

/** Exported for unit tests. */
export function parseManifestItems(opf: string): ManifestItem[] {
  const items: ManifestItem[] = []
  const re = /<item\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(opf))) {
    const attrs = parseXmlAttrs(m[0])
    const id = attrs.id || ''
    const href = attrs.href || ''
    if (!href) continue
    items.push({
      id,
      href,
      mediaType: (attrs['media-type'] || attrs.mediatype || '').toLowerCase(),
      properties: (attrs.properties || '').toLowerCase(),
    })
  }
  return items
}

/** Exported for unit tests. */
export function resolveEpubCoverHref(opf: string, items: ManifestItem[]): string | undefined {
  const byId = new Map(items.filter((i) => i.id).map((i) => [i.id.toLowerCase(), i]))

  // EPUB2: <meta name="cover" content="id"/>
  const metaCoverId =
    opf.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1] ||
    opf.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']cover["']/i)?.[1]
  if (metaCoverId) {
    const hit = byId.get(metaCoverId.toLowerCase())
    if (hit) return hit.href
    // Some books put the filename directly in content
    if (/\.(jpe?g|png|gif|webp|svg)$/i.test(metaCoverId)) return metaCoverId
  }

  // EPUB3: properties="cover-image"
  const propCover = items.find((i) => /\bcover-image\b/.test(i.properties) && isImageItem(i))
  if (propCover) return propCover.href

  // Common ids
  const idCover = items.find(
    (i) => isImageItem(i) && /^(cover|cover-image|coverimage|ci)$/i.test(i.id),
  )
  if (idCover) return idCover.href

  // Href looks like a cover asset
  const hrefCover = items.find(
    (i) => isImageItem(i) && /(^|\/)cover[^/]*\.(jpe?g|png|gif|webp)$/i.test(i.href),
  )
  if (hrefCover) return hrefCover.href

  return undefined
}

function isImageItem(i: ManifestItem): boolean {
  if (i.mediaType.startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(i.href)
}

function parseXmlAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([:\w.-]+)\s*=\s*["']([^"']*)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[2]
  }
  return attrs
}

async function findFirstManifestImage(
  zip: JSZip,
  opfDir: string,
  items: ManifestItem[],
): Promise<Blob | undefined> {
  for (const item of items) {
    if (!isImageItem(item)) continue
    // Skip tiny icons / glyphs often named mark, glyph, etc.
    if (/(icon|glyph|bullet|ornament|spacer|pixel)/i.test(item.href)) continue
    const blob = await loadZipImage(zip, resolveZipPath(opfDir, item.href))
    if (blob && blob.size >= 2_000) return blob
  }
  return undefined
}

async function loadZipImage(zip: JSZip, path: string): Promise<Blob | undefined> {
  const entry = zipFind(zip, path)
  if (!entry) return undefined
  const buf = await entry.async('arraybuffer')
  if (!buf.byteLength) return undefined
  const mime = mimeFromPath(path)
  return new Blob([buf], { type: mime })
}

function zipFind(zip: JSZip, path: string) {
  const norm = path.replace(/^\/+/, '')
  const direct = zip.file(norm)
  if (direct) return direct
  const lower = norm.toLowerCase()
  for (const key of Object.keys(zip.files)) {
    if (zip.files[key].dir) continue
    if (key.replace(/^\/+/, '').toLowerCase() === lower) return zip.file(key)
  }
  return null
}

async function zipReadText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zipFind(zip, path)
  if (!entry) return null
  return entry.async('text')
}

function mimeFromPath(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.webp$/i.test(path)) return 'image/webp'
  if (/\.gif$/i.test(path)) return 'image/gif'
  if (/\.svg$/i.test(path)) return 'image/svg+xml'
  return 'image/jpeg'
}

export function resolveZipPath(base: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = `${base}${cleaned}`.split('/')
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

async function renderTitleCover(title: string): Promise<Blob | undefined> {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  const w = 280
  const h = 400
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined

  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#2a3548')
  grad.addColorStop(1, '#161b26')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = 'rgba(196, 165, 116, 0.85)'
  ctx.fillRect(18, 18, 4, h - 36)

  ctx.fillStyle = '#e8e2d6'
  ctx.font = '700 28px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'left'
  const lines = wrapText(ctx, title.slice(0, 48), w - 56)
  let y = h * 0.38
  for (const line of lines.slice(0, 5)) {
    ctx.fillText(line, 36, y)
    y += 36
  }

  return canvasToBlob(canvas, 'image/jpeg', 0.86)
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const chars = [...text]
  const lines: string[] = []
  let cur = ''
  for (const ch of chars) {
    const next = cur + ch
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur)
      cur = ch
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b || undefined), type, quality)
  })
}
