import JSZip from 'jszip'
import type { BookFormat } from '@/types'

export interface MetaResult {
  title?: string
  author?: string
  cover?: Blob
}

export async function extractCoverAndMeta(file: Blob, format: BookFormat): Promise<MetaResult> {
  try {
    if (format === 'epub') return extractEpubMeta(file)
    if (format === 'txt') {
      return { title: undefined, author: undefined }
    }
    if (format === 'pdf') return { title: undefined }
  } catch {
    /* ignore parse errors */
  }
  return {}
}

async function extractEpubMeta(file: Blob): Promise<MetaResult> {
  const zip = await JSZip.loadAsync(file)
  const container = await zip.file('META-INF/container.xml')?.async('text')
  if (!container) return {}
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1]
  if (!opfPath) return {}
  const opf = await zip.file(opfPath)?.async('text')
  if (!opf) return {}

  const title = opf.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)?.[1]?.trim()
  const author = opf.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)?.[1]?.trim()

  let cover: Blob | undefined
  const coverId =
    opf.match(/<meta[^>]+name="cover"[^>]+content="([^"]+)"/i)?.[1] ||
    opf.match(/<item[^>]+id="cover-image"[^>]+href="([^"]+)"/i)?.[1]

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  if (coverId) {
    const href =
      opf.match(new RegExp(`<item[^>]+id="${coverId}"[^>]+href="([^"]+)"`, 'i'))?.[1] ||
      (coverId.includes('.') ? coverId : undefined)
    if (href) {
      const path = resolveZipPath(opfDir, href)
      const entry = zip.file(path)
      if (entry) {
        const buf = await entry.async('blob')
        const mime = href.match(/\.png$/i) ? 'image/png' : 'image/jpeg'
        cover = new Blob([buf], { type: mime })
      }
    }
  }
  return { title, author, cover }
}

function resolveZipPath(base: string, rel: string): string {
  const parts = (base + rel).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}
