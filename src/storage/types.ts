import type { BookFormat, BookRecord } from '@/types'

export interface ImportResult {
  book: BookRecord
  duplicated?: boolean
}

export interface LibraryStorage {
  kind: 'idb' | 'fs'
  listBooks(): Promise<BookRecord[]>
  importFiles(files: File[]): Promise<ImportResult[]>
  getBookBlob(bookId: string): Promise<Blob | null>
  deleteBook(bookId: string): Promise<void>
  updateBook(bookId: string, patch: Partial<BookRecord>): Promise<void>
}

export function detectFormat(name: string): BookFormat | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.pdf')) return 'pdf'
  return null
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.(epub|txt|pdf)$/i, '').trim() || name
}

export async function sampleHash(file: Blob, size = 64 * 1024): Promise<string> {
  const slice = file.slice(0, Math.min(size, file.size))
  const buf = await slice.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  const bytes = Array.from(new Uint8Array(hashBuf))
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + `:${file.size}`
}

export function uid(prefix = 'b'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
