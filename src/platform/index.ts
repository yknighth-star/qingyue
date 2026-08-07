import type { Platform } from './types'
import { createWebPlatform } from './web'

export type {
  ClipboardApi,
  LibraryFiles,
  LinkedRootInfo,
  Platform,
  PlatformEnv,
  PlatformKind,
  StorageQuota,
  TtsApi,
} from './types'

let current: Platform | null = null

/** Call once at app boot. Pass a custom platform for desktop/mobile shells later. */
export function initPlatform(platform?: Platform): Platform {
  current = platform ?? createWebPlatform()
  return current
}

export function getPlatform(): Platform {
  if (!current) return initPlatform()
  return current
}

export { createWebPlatform }
