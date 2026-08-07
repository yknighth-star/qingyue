import type { Platform } from '../types'
import { createWebClipboard } from './clipboard'
import { createWebLibraryFiles } from './files'
import { createWebTtsApi } from './tts'

export function createWebPlatform(): Platform {
  const canLink = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
  return {
    env: {
      kind: 'web',
      canLinkFolder: canLink,
      libraryMode: 'idb-or-folder',
    },
    files: createWebLibraryFiles(),
    tts: createWebTtsApi(),
    clipboard: createWebClipboard(),
  }
}
