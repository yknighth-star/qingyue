import { db } from '@/db'
import { getPlatform } from '@/platform'
import type { BookRecord } from '@/types'

/** Local book metadata — single write path for future sync hooks. */
export const booksRepo = {
  async list(): Promise<BookRecord[]> {
    const all = await db.books.toArray()
    return all.filter((b) => !b.deletedAt)
  },

  async listIncludingDeleted(): Promise<BookRecord[]> {
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

  /** Atomic IDB import: book row + blob file. */
  async putWithBlob(book: BookRecord, blob: Blob, name: string): Promise<void> {
    const stamped = { ...book, updatedAt: book.updatedAt ?? Date.now() }
    await db.transaction('rw', db.books, db.bookFiles, async () => {
      await db.books.put(stamped)
      await db.bookFiles.put({ bookId: book.id, blob, name })
    })
  },

  async count(): Promise<number> {
    const all = await db.books.toArray()
    return all.filter((b) => !b.deletedAt).length
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

  /** Soft-delete for future sync tombstones (keeps blob until hard purge). */
  async softDelete(id: string): Promise<void> {
    await db.books.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
  },

  /**
   * Hard-delete book + related rows.
   * @param removeBlob — also drop IndexedDB blob (default true for idb books)
   */
  async hardDelete(id: string, opts?: { removeBlob?: boolean }): Promise<void> {
    const removeBlob = opts?.removeBlob !== false
    await db.transaction('rw', db.books, db.bookFiles, db.progress, db.annotations, async () => {
      await db.books.delete(id)
      if (removeBlob) await db.bookFiles.delete(id)
      await db.progress.delete(id)
      await db.annotations.where('bookId').equals(id).delete()
    })
  },

  /** Platform-facing delete (storage adapters decide idb vs fs). */
  async delete(id: string): Promise<void> {
    await getPlatform().files.deleteBook(id)
  },
}
