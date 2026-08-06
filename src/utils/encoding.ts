/** Detect UTF-8 / GBK / GB18030 for TXT files */

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function looksLikeUtf8(bytes: Uint8Array): boolean {
  let i = 0
  while (i < bytes.length) {
    const c = bytes[i]
    if (c <= 0x7f) {
      i++
      continue
    }
    let need = 0
    if ((c & 0xe0) === 0xc0) need = 1
    else if ((c & 0xf0) === 0xe0) need = 2
    else if ((c & 0xf8) === 0xf0) need = 3
    else return false
    if (i + need >= bytes.length) return false
    for (let j = 1; j <= need; j++) {
      if ((bytes[i + j] & 0xc0) !== 0x80) return false
    }
    i += need + 1
  }
  return true
}

export async function decodeTextBlob(blob: Blob, preferred?: string): Promise<{ text: string; encoding: string }> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)

  if (preferred) {
    try {
      return { text: new TextDecoder(preferred).decode(bytes), encoding: preferred }
    } catch {
      /* fall through */
    }
  }

  if (hasUtf8Bom(bytes) || looksLikeUtf8(bytes.slice(0, Math.min(bytes.length, 256 * 1024)))) {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }
  }

  for (const enc of ['gb18030', 'gbk', 'gb2312']) {
    try {
      const text = new TextDecoder(enc).decode(bytes)
      if (!text.includes('\uFFFD') || enc === 'gb18030') {
        return { text, encoding: enc }
      }
    } catch {
      /* ignore */
    }
  }

  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), encoding: 'utf-8' }
}

const CHAPTER_RE =
  /^(第[零一二三四五六七八九十百千万0-9]+[章节回卷部集]|Chapter\s+\d+|CHAPTER\s+\d+)[^\n]{0,40}$/gm

export interface TxtChapter {
  id: number
  title: string
  start: number
  end: number
}

export function splitTxtChapters(text: string): TxtChapter[] {
  const matches = [...text.matchAll(CHAPTER_RE)]
  if (matches.length < 2) {
    return [{ id: 0, title: '全文', start: 0, end: text.length }]
  }
  const chapters: TxtChapter[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = m.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length
    chapters.push({
      id: i,
      title: m[0].trim().slice(0, 60),
      start,
      end,
    })
  }
  if (chapters[0].start > 0) {
    chapters.unshift({ id: -1, title: '前言', start: 0, end: chapters[0].start })
    chapters.forEach((c, i) => {
      c.id = i
    })
  }
  return chapters
}
