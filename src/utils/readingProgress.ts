import type { BookRecord } from '@/types'
import { formatPercent } from '@/utils/format'

/** Opened at least once, or has non-zero progress. */
export function hasStartedReading(b: Pick<BookRecord, 'lastReadAt' | 'progressPercent'>): boolean {
  return Boolean(b.lastReadAt) || (b.progressPercent || 0) > 0
}

export function isFinishedReading(b: Pick<BookRecord, 'progressPercent'>): boolean {
  return (b.progressPercent || 0) >= 99
}

export function isUnread(b: Pick<BookRecord, 'lastReadAt' | 'progressPercent'>): boolean {
  return !hasStartedReading(b)
}

export function isCurrentlyReading(b: Pick<BookRecord, 'lastReadAt' | 'progressPercent'>): boolean {
  return hasStartedReading(b) && !isFinishedReading(b)
}

/** Shelf card label: 未读 / 在读 / n% / 读完 */
export function readingProgressLabel(b: Pick<BookRecord, 'lastReadAt' | 'progressPercent'>): string {
  if (isFinishedReading(b)) return '读完'
  if (!hasStartedReading(b)) return '未读'
  const pct = b.progressPercent || 0
  if (pct <= 0) return '在读'
  const rounded = Math.round(pct)
  if (rounded <= 0) return '<1%'
  if (rounded >= 99) return '读完'
  return formatPercent(pct)
}
