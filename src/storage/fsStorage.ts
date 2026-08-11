import { db } from '@/db'
import { booksRepo } from '@/repos'
import type { BookRecord } from '@/types'
import {
  detectFormat,
  sampleHash,
  uid,
  type ImportResult,
  type LibraryStorage,
} from './types'
import { idbStorage } from './idbStorage'
import { extractCoverAndMeta } from './meta'
import { tagsWithAutoFolder } from '@/utils/shelfTags'
import { pickBookAuthor, pickBookTitle } from '@/utils/bookMeta'
import { rememberBookBlob } from '@/utils/bookBlobCache'

const ROOT_ID = 'default'

/**
 * Check / optionally request FS access.
 * `requestPermission` requires a user gesture — never use interactive on app mount.
 */
async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  options?: { interactive?: boolean },
): Promise<boolean> {
  const opts = { mode: 'read' as const }
  const interactive = Boolean(options?.interactive)
  try {
    if (handle.queryPermission) {
      const state = await handle.queryPermission(opts)
      if (state === 'granted') return true
      if (state === 'denied') return false
      // "prompt" — only escalate when the caller is a user gesture
      if (!interactive || !handle.requestPermission) return false
      const next = await handle.requestPermission(opts)
      return next === 'granted'
    }
  } catch (err) {
    // SecurityError when requestPermission runs without user activation
    if (!interactive) return false
    console.warn('FS permission failed', err)
    return false
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

/** Linked folder metadata from IDB — safe on mount (no permission prompt). */
export async function peekLinkedRoot(): Promise<(FsRootInfo & { handle: FileSystemDirectoryHandle }) | null> {
  const row = await db.fsRoots.get(ROOT_ID)
  if (!row) return null
  return { id: row.id, name: row.name, handle: row.handle }
}

/** Resolve linked root with permission. Use interactive:true only from click/tap handlers. */
export async function getLinkedRoot(options?: {
  interactive?: boolean
}): Promise<(FsRootInfo & { handle: FileSystemDirectoryHandle }) | null> {
  const row = await peekLinkedRoot()
  if (!row) return null
  const ok = await ensurePermission(row.handle, options)
  if (!ok) return null
  return row
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
  // User clicked 关联/同步 — may prompt for permission
  const root = await getLinkedRoot({ interactive: true })
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
    const meta = await extractCoverAndMeta(file, format, { mode: 'quick' })
    const book: BookRecord = {
      id: uid('book'),
      title: pickBookTitle(meta.title, path.split('/').pop() || path),
      author: pickBookAuthor(meta.author),
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
    // Keep File handle blob warm so first open after scan skips a second FS round-trip.
    rememberBookBlob(book.id, file)
    existing.push(book)
    results.push({ book })
  }
  return results
}

async function resolveFsFile(fsPath: string): Promise<File | null> {
  // Opening a book is a user gesture
  const root = await getLinkedRoot({ interactive: true })
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
    return (await booksRepo.list()).filter((b) => b.storage === 'fs')
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
    // FS books have no IDB blob — only meta + progress + annots
    await booksRepo.hardDelete(bookId, { removeBlob: false })
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
