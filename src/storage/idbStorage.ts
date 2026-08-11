import { db } from '@/db'
import { booksRepo } from '@/repos'
import { MAX_IDB_FILE_BYTES } from '@/types'
import type { BookRecord } from '@/types'
import {
  detectFormat,
  sampleHash,
  uid,
  type ImportResult,
  type LibraryStorage,
} from './types'
import { extractCoverAndMeta } from './meta'
import { pickBookAuthor, pickBookTitle } from '@/utils/bookMeta'
import { rememberBookBlob } from '@/utils/bookBlobCache'

export const idbStorage: LibraryStorage = {
  kind: 'idb',

  async listBooks() {
    return (await booksRepo.list()).filter((b) => b.storage === 'idb')
  },

  async importFiles(files: File[]): Promise<ImportResult[]> {
    const results: ImportResult[] = []
    for (const file of files) {
      const format = detectFormat(file.name)
      if (!format) continue
      if (file.size > MAX_IDB_FILE_BYTES) {
        throw new Error(
          `「${file.name}」超过 ${Math.round(MAX_IDB_FILE_BYTES / 1024 / 1024)}MB。请改用「关联目录」从磁盘读取大书。`,
        )
      }
      const contentHash = await sampleHash(file)
      const existing = await booksRepo.listIncludingDeleted()
      const dup = existing.find((b) => b.storage === 'idb' && b.contentHash === contentHash && !b.deletedAt)
      if (dup) {
        results.push({ book: dup, duplicated: true })
        continue
      }
      // Quick meta only — covers fill in on idle backfill so import stays snappy on phone.
      const meta = await extractCoverAndMeta(file, format, { mode: 'quick' })
      const book: BookRecord = {
        id: uid('book'),
        title: pickBookTitle(meta.title, file.name),
        author: pickBookAuthor(meta.author),
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
      await booksRepo.putWithBlob(book, file, file.name)
      rememberBookBlob(book.id, file)
      results.push({ book })
    }
    return results
  },

  async getBookBlob(bookId: string) {
    const row = await db.bookFiles.get(bookId)
    return row?.blob ?? null
  },

  async deleteBook(bookId: string) {
    await booksRepo.hardDelete(bookId, { removeBlob: true })
  },

  async updateBook(bookId: string, patch: Partial<BookRecord>) {
    await booksRepo.update(bookId, patch)
  },
}
