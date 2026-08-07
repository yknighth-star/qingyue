import { idbStorage } from '@/storage/idbStorage'
import {
  deleteBookAny,
  getBookBlobAny,
  linkLibraryFolder,
  peekLinkedRoot,
  scanLibraryFolder,
  supportsFsAccess,
} from '@/storage/fsStorage'
import type { LibraryFiles, LinkedRootInfo, StorageQuota } from '../types'

export function createWebLibraryFiles(): LibraryFiles {
  return {
    supportsLinkFolder: () => supportsFsAccess(),

    async linkFolder(): Promise<LinkedRootInfo | null> {
      return linkLibraryFolder()
    },

    async getLinkedRoot(): Promise<LinkedRootInfo | null> {
      // Peek only — never requestPermission during shelf refresh / app mount
      const root = await peekLinkedRoot()
      if (!root) return null
      return { id: root.id, name: root.name }
    },

    scanLinkedFolder: () => scanLibraryFolder(),

    importFiles: (files) => idbStorage.importFiles(files),

    getBookBlob: (bookId) => getBookBlobAny(bookId),

    deleteBook: (bookId) => deleteBookAny(bookId),

    async estimateQuota(): Promise<StorageQuota | null> {
      try {
        if (!navigator.storage?.estimate) return null
        const { usage = 0, quota = 1 } = await navigator.storage.estimate()
        return { usage, quota }
      } catch {
        return null
      }
    },
  }
}
