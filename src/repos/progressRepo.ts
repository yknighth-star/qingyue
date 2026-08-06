import { db } from '@/db'
import type { ProgressRecord } from '@/types'
import { booksRepo } from './booksRepo'

export const progressRepo = {
  async get(bookId: string): Promise<ProgressRecord | undefined> {
    return db.progress.get(bookId)
  },

  async save(
    bookId: string,
    locator: ProgressRecord['locator'],
    percent: number,
  ): Promise<{ updatedAt: number }> {
    const updatedAt = Date.now()
    await db.progress.put({ bookId, locator, percent, updatedAt })
    await booksRepo.update(bookId, { progressPercent: percent, lastReadAt: updatedAt })
    return { updatedAt }
  },

  async put(record: ProgressRecord): Promise<void> {
    await db.progress.put({
      ...record,
      updatedAt: record.updatedAt ?? Date.now(),
    })
  },
}
