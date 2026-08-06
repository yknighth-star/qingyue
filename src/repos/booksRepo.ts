import { db } from '@/db'
import { getPlatform } from '@/platform'
import type { BookRecord } from '@/types'

/** Local book metadata — single write path for future sync hooks. */
export const booksRepo = {
  async list(): Promise<BookRecord[]> {
    return db.books.toArray()
  },

  async get(id: string): Promise<BookRecord | undefined> {
    return db.books.get(id)
  },

  async update(id: string, patch: Partial<BookRecord>): Promise<void> {
    const next = { ...patch, updatedAt: Date.now() }
    await db.books.update(id, next)
  },

  async put(book: BookRecord): Promise<void> {
    await db.books.put({ ...book, updatedAt: book.updatedAt ?? Date.now() })
  },

  async count(): Promise<number> {
    return db.books.count()
  },

  async clearMetaTables(): Promise<void> {
    await db.books.clear()
    await db.bookFiles.clear()
    await db.progress.clear()
    await db.annotations.clear()
  },

  async getBlob(id: string): Promise<Blob | null> {
    return getPlatform().files.getBookBlob(id)
  },

  async delete(id: string): Promise<void> {
    await getPlatform().files.deleteBook(id)
  },
}
