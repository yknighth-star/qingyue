/** Case-insensitive indexOf; returns index in the original haystack. */
export function indexOfIgnoreCase(haystack: string, needle: string, fromIndex = 0): number {
  if (!needle) return fromIndex <= haystack.length ? fromIndex : -1
  return haystack.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), fromIndex)
}

/**
 * Collapse whitespace between CJK characters ("螃 蟹" → "螃蟹").
 * Common in PDF.js extractions text and OCR output.
 */
export function compactCjkGaps(text: string): string {
  return text.replace(
    /([\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F])(?:[\s\u00A0\u2000-\u200B\uFEFF]+)(?=[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F])/g,
    '$1',
  )
}

/**
 * Find needle in haystack, ignoring case and whitespace gaps (esp. CJK).
 * Returns start index in the original haystack, or -1.
 */
export function indexOfFlexible(haystack: string, needle: string, fromIndex = 0): number {
  const n = needle.trim()
  if (!n) return fromIndex <= haystack.length ? fromIndex : -1

  const direct = indexOfIgnoreCase(haystack, n, fromIndex)
  if (direct >= 0) return direct

  const compactNeedle = n.replace(/\s+/g, '')
  if (!compactNeedle) return -1

  // Map compact string indices → original haystack indices
  const map: number[] = []
  let compact = ''
  for (let i = Math.max(0, fromIndex); i < haystack.length; i++) {
    const ch = haystack[i]
    if (/\s/.test(ch)) continue
    map.push(i)
    compact += ch
  }

  const found = compact.toLocaleLowerCase().indexOf(compactNeedle.toLocaleLowerCase())
  if (found < 0) return -1
  return map[found] ?? -1
}
