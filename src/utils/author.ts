/** Legacy / exporter placeholders — treat as “no author”. */
const EMPTY_AUTHOR_MARKERS = new Set(
  [
    '未知作者',
    'unknown',
    'unknown author',
    'anonymous',
    'admin',
    'administrator',
    'user',
    'owner',
    'author',
    '作者',
    'microsoft',
    'microsoft office',
    'microsoft office user',
    'adobe',
    'adobe acrobat',
    'wps',
  ].map((s) => s.toLowerCase()),
)

const JUNK_AUTHOR_PATTERNS = [
  // Device / SKU style: M2102K1C, SM-G9910
  /^[a-z]{0,4}\d{2,}[a-z0-9-]{2,}$/i,
  // Internal project codes: eYOU-SEPG, ABC_DEF
  /^[a-z]{1,6}[-_][a-z0-9]{2,12}$/i,
  /^[a-z]+\\[a-z]+$/i, // DOMAIN\user
  /^user\s*\d*$/i,
]

/** Normalize for storage / comparison: trim; drop legacy / junk placeholders. */
export function normalizeAuthor(raw?: string | null): string {
  const a = (raw || '').replace(/\0/g, '').trim()
  if (!a) return ''
  if (EMPTY_AUTHOR_MARKERS.has(a.toLowerCase()) || a === '未知作者') return ''
  if (JUNK_AUTHOR_PATTERNS.some((re) => re.test(a))) return ''
  // Pure digits / too short codes
  if (/^[\d\s._-]+$/.test(a)) return ''
  if (a.length <= 1) return ''
  return a
}

/** Shelf / UI: empty means hide the author line. */
export function displayAuthor(raw?: string | null): string {
  return normalizeAuthor(raw)
}

/** When a visible label is required (export, share). */
export function authorOrAnonymous(raw?: string | null): string {
  return normalizeAuthor(raw) || '佚名'
}
