import { db } from '@/db'
import type { AnnotationRecord } from '@/types'

export const annotationsRepo = {
  async listByBook(bookId: string): Promise<AnnotationRecord[]> {
    return db.annotations.where('bookId').equals(bookId).reverse().sortBy('createdAt')
  },

  async countByBook(bookId: string): Promise<number> {
    return db.annotations.where('bookId').equals(bookId).count()
  },

  async add(annot: AnnotationRecord): Promise<void> {
    const row: AnnotationRecord = {
      ...annot,
      updatedAt: annot.updatedAt ?? annot.createdAt ?? Date.now(),
    }
    await db.annotations.put(row)
  },

  async put(annot: AnnotationRecord): Promise<void> {
    await db.annotations.put({
      ...annot,
      updatedAt: annot.updatedAt ?? Date.now(),
    })
  },

  async remove(id: string): Promise<void> {
    await db.annotations.delete(id)
  },

  async listByBookRaw(bookId: string): Promise<AnnotationRecord[]> {
    return db.annotations.where('bookId').equals(bookId).toArray()
  },
}
