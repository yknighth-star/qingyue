import { titleFromFilename } from '@/storage/types'
import { normalizeAuthor } from '@/utils/author'

/** Office / exporter placeholder titles that should lose to the filename. */
const JUNK_TITLE_EXACT = new Set(
  [
    'untitled',
    'untitled document',
    'document',
    'new document',
    'microsoft word',
    'microsoft word - document',
    'powerpoint presentation',
    'presentation',
    'workbook',
    'sheet1',
    '项目名称',
    '空白演示',
    '演示文稿',
    '演示文稿1',
    '新建文档',
    '新建 Microsoft Word 文档',
    '文档1',
    '文稿1',
    '无标题',
    '未命名',
    '未命名文档',
    '标题',
    '书名',
  ].map((s) => s.toLowerCase()),
)

const JUNK_TITLE_PATTERNS = [
  /^untitled(\s+\d+)?$/i,
  /^document\s*\d*$/i,
  /^presentation\s*\d*$/i,
  /^microsoft\b/i,
  /^powerpoint\b/i,
  /^doc\d+$/i,
  /^新建(文档|文稿|演示文稿)\d*$/i,
  /^演示文稿\d*$/i,
  /^文档\d+$/i,
  /^文稿\d+$/i,
]

/** Drop empty / placeholder metadata titles. */
export function sanitizeMetaTitle(raw?: string | null): string | undefined {
  const t = (raw || '').replace(/\0/g, '').trim()
  if (!t) return undefined
  if (t.length < 2) return undefined
  const lower = t.toLowerCase()
  if (JUNK_TITLE_EXACT.has(lower)) return undefined
  if (JUNK_TITLE_PATTERNS.some((re) => re.test(t))) return undefined
  // Single generic token often from templates
  if (/^(title|name|filename|文件名|名称)$/i.test(t)) return undefined
  return t
}

/** True when the stored title looks like an exporter placeholder. */
export function isPlaceholderTitle(raw?: string | null): boolean {
  const t = (raw || '').trim()
  if (!t) return true
  return sanitizeMetaTitle(t) === undefined
}

/** Prefer clean metadata title; otherwise filename (sans extension). */
export function pickBookTitle(metaTitle: string | undefined | null, fileName: string): string {
  return sanitizeMetaTitle(metaTitle) || titleFromFilename(fileName)
}

export function pickBookAuthor(metaAuthor: string | undefined | null): string {
  return normalizeAuthor(metaAuthor)
}
