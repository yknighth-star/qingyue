import { db } from '@/db'
import { booksRepo } from '@/repos'
import type { BookRecord } from '@/types'
import {
  detectFormat,
  sampleHash,
  titleFromFilename,
  uid,
  type ImportResult,
  type LibraryStorage,
} from './types'
import { idbStorage } from './idbStorage'
import { extractCoverAndMeta } from './meta'
import { tagsWithAutoFolder } from '@/utils/shelfTags'

const ROOT_ID = 'default'

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'read' as const }
  if (handle.queryPermission) {
    let state = await handle.queryPermission(opts)
    if (state === 'granted') return true
    if (handle.requestPermission) {
      state = await handle.requestPermission(opts)
      return state === 'granted'
    }
  }
  return true
}

export function supportsFsAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function linkLibraryFolder(): Promise<FsRootInfo | null> {
  if (!supportsFsAccess() || !window.showDirectoryPicker) return null
  let handle: FileSystemDirectoryHandle
  try {
    handle = await window.showDirectoryPicker({ id: 'ebook-books', mode: 'read' })
  } catch (err) {
    // User closed the picker or permission denied — not a hard failure
    if (isUserAbort(err)) return null
    throw err
  }
  await db.fsRoots.put({
    id: ROOT_ID,
    name: handle.name,
    handle,
    linkedAt: Date.now(),
  })
  return { id: ROOT_ID, name: handle.name }
}

function isUserAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string }
  if (e.name === 'AbortError' || e.name === 'NotAllowedError') return true
  return typeof e.message === 'string' && /aborted a request|user cancelled|user aborted/i.test(e.message)
}

export interface FsRootInfo {
  id: string
  name: string
}

export async function getLinkedRoot(): Promise<(FsRootInfo & { handle: FileSystemDirectoryHandle }) | null> {
  const row = await db.fsRoots.get(ROOT_ID)
  if (!row) return null
  const ok = await ensurePermission(row.handle)
  if (!ok) return null
  return { id: row.id, name: row.name, handle: row.handle }
}

async function* walkFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  // @ts-expect-error async iterator
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file') {
      yield { path, handle: handle as FileSystemFileHandle }
    } else if (handle.kind === 'directory') {
      yield* walkFiles(handle as FileSystemDirectoryHandle, path)
    }
  }
}

export async function scanLibraryFolder(): Promise<ImportResult[]> {
  const root = await getLinkedRoot()
  if (!root) return []
  const results: ImportResult[] = []
  const existing = await db.books.toArray()

  for await (const { path, handle } of walkFiles(root.handle)) {
    const format = detectFormat(path)
    if (!format) continue
    const file = await handle.getFile()
    const contentHash = await sampleHash(file)
    const dup = existing.find((b) => b.contentHash === contentHash || (b.storage === 'fs' && b.fsPath === path))
    if (dup) {
      const nextTags = tagsWithAutoFolder(dup.tags || [], path)
      if (nextTags.length !== (dup.tags || []).length) {
        await booksRepo.update(dup.id, { tags: nextTags })
        dup.tags = nextTags
      }
      results.push({ book: dup, duplicated: true })
      continue
    }
    const meta = await extractCoverAndMeta(file, format)
    const book: BookRecord = {
      id: uid('book'),
      title: meta.title || titleFromFilename(path.split('/').pop() || path),
      author: meta.author || '未知作者',
      format,
      cover: meta.cover,
      fileSize: file.size,
      storage: 'fs',
      fsPath: path,
      addedAt: Date.now(),
      isFavorite: false,
      progressPercent: 0,
      tags: tagsWithAutoFolder([], path),
      contentHash,
      updatedAt: Date.now(),
    }
    await booksRepo.put(book)
    existing.push(book)
    results.push({ book })
  }
  return results
}

async function resolveFsFile(fsPath: string): Promise<File | null> {
  const root = await getLinkedRoot()
  if (!root) return null
  const parts = fsPath.split('/').filter(Boolean)
  let dir: FileSystemDirectoryHandle = root.handle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1])
  return fileHandle.getFile()
}

export const fsStorage: LibraryStorage = {
  kind: 'fs',

  async listBooks() {
    return db.books.where('storage').equals('fs').toArray()
  },

  async importFiles(files: File[]) {
    // FS mode prefers folder scan; file pick still stores into IndexedDB
    return idbStorage.importFiles(files)
  },

  async getBookBlob(bookId: string) {
    const book = await db.books.get(bookId)
    if (!book?.fsPath) return null
    return resolveFsFile(book.fsPath)
  },

  async deleteBook(bookId: string) {
    await db.transaction('rw', db.books, db.progress, db.annotations, async () => {
      await db.books.delete(bookId)
      await db.progress.delete(bookId)
      await db.annotations.where('bookId').equals(bookId).delete()
    })
  },

  async updateBook(bookId: string, patch: Partial<BookRecord>) {
    await booksRepo.update(bookId, patch)
  },
}

export async function getBookBlobAny(bookId: string): Promise<Blob | null> {
  const book = await db.books.get(bookId)
  if (!book) return null
  if (book.storage === 'fs') return fsStorage.getBookBlob(bookId)
  return idbStorage.getBookBlob(bookId)
}

export async function deleteBookAny(bookId: string): Promise<void> {
  const book = await db.books.get(bookId)
  if (!book) return
  if (book.storage === 'fs') await fsStorage.deleteBook(bookId)
  else await idbStorage.deleteBook(bookId)
}
