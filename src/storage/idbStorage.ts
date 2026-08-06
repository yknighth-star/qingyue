import { db } from '@/db'
import { MAX_IDB_FILE_BYTES } from '@/types'
import type { BookRecord } from '@/types'
import {
  detectFormat,
  sampleHash,
  titleFromFilename,
  uid,
  type ImportResult,
  type LibraryStorage,
} from './types'
import { extractCoverAndMeta } from './meta'

export const idbStorage: LibraryStorage = {
  kind: 'idb',

  async listBooks() {
    return db.books.where('storage').equals('idb').toArray()
  },

  async importFiles(files: File[]): Promise<ImportResult[]> {
    const results: ImportResult[] = []
    for (const file of files) {
      const format = detectFormat(file.name)
      if (!format) continue
      if (file.size > MAX_IDB_FILE_BYTES) {
        throw new Error(
          `「${file.name}」超过 ${Math.round(MAX_IDB_FILE_BYTES / 1024 / 1024)}MB。请改用「关联文件夹」从磁盘读取大文件。`,
        )
      }
      const contentHash = await sampleHash(file)
      const existing = await db.books.where('storage').equals('idb').toArray()
      const dup = existing.find((b) => b.contentHash === contentHash)
      if (dup) {
        results.push({ book: dup, duplicated: true })
        continue
      }
      const meta = await extractCoverAndMeta(file, format)
      const book: BookRecord = {
        id: uid('book'),
        title: meta.title || titleFromFilename(file.name),
        author: meta.author || '未知作者',
        format,
        cover: meta.cover,
        fileSize: file.size,
        storage: 'idb',
        addedAt: Date.now(),
        isFavorite: false,
        progressPercent: 0,
        tags: [],
        contentHash,
        updatedAt: Date.now(),
      }
      await db.transaction('rw', db.books, db.bookFiles, async () => {
        await db.books.put(book)
        await db.bookFiles.put({ bookId: book.id, blob: file, name: file.name })
      })
      results.push({ book })
    }
    return results
  },

  async getBookBlob(bookId: string) {
    const row = await db.bookFiles.get(bookId)
    return row?.blob ?? null
  },

  async deleteBook(bookId: string) {
    await db.transaction('rw', db.books, db.bookFiles, db.progress, db.annotations, async () => {
      await db.books.delete(bookId)
      await db.bookFiles.delete(bookId)
      await db.progress.delete(bookId)
      await db.annotations.where('bookId').equals(bookId).delete()
    })
  },

  async updateBook(bookId: string, patch: Partial<BookRecord>) {
    await db.books.update(bookId, patch)
  },
}
