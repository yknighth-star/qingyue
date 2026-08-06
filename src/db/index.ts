import Dexie, { type Table } from 'dexie'
import type {
  AnnotationRecord,
  BookFileRecord,
  BookRecord,
  FsRootRecord,
  ProgressRecord,
  ReaderSettings,
  StatsRecord,
} from '@/types'

export class EbookDB extends Dexie {
  books!: Table<BookRecord, string>
  bookFiles!: Table<BookFileRecord, string>
  fsRoots!: Table<FsRootRecord, string>
  progress!: Table<ProgressRecord, string>
  annotations!: Table<AnnotationRecord, string>
  settings!: Table<ReaderSettings & { id: string }, string>
  stats!: Table<StatsRecord, string>

  constructor() {
    super('h5-ebook-reader')
    this.version(1).stores({
      books: 'id, title, format, lastReadAt, isFavorite, addedAt, storage',
      bookFiles: 'bookId',
      fsRoots: 'id, name',
      progress: 'bookId, updatedAt',
      annotations: 'id, bookId, type, createdAt',
      settings: 'id',
      stats: 'id',
    })
  }
}

export const db = new EbookDB()
