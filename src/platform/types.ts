import type { ImportResult } from '@/storage/types'
import type { TtsController } from '@/utils/tts'

/** Runtime shell: web today; desktop/mobile later via Tauri / Capacitor. */
export type PlatformKind = 'web' | 'desktop' | 'ios' | 'android'

export interface PlatformEnv {
  kind: PlatformKind
  /** Desktop browsers / Tauri: link a library folder. Mobile usually false. */
  canLinkFolder: boolean
  /**
   * idb-or-folder — small files in IDB, large via folder reference (web/desktop).
   * sandbox-import — copy into app storage (mobile later).
   */
  libraryMode: 'idb-or-folder' | 'sandbox-import'
}

export interface LinkedRootInfo {
  id: string
  name: string
}

export interface StorageQuota {
  usage: number
  quota: number
}

/** File / library operations — swap implementation per shell. */
export interface LibraryFiles {
  supportsLinkFolder(): boolean
  linkFolder(): Promise<LinkedRootInfo | null>
  getLinkedRoot(): Promise<LinkedRootInfo | null>
  scanLinkedFolder(): Promise<ImportResult[]>
  importFiles(files: File[]): Promise<ImportResult[]>
  getBookBlob(bookId: string): Promise<Blob | null>
  deleteBook(bookId: string): Promise<void>
  estimateQuota(): Promise<StorageQuota | null>
}

export interface ClipboardApi {
  writeText(text: string): Promise<boolean>
}

export interface TtsApi {
  create(): TtsController
  voiceIdOf(v: SpeechSynthesisVoice): string
  pickVoice(voiceId?: string): SpeechSynthesisVoice | null
}

export interface Platform {
  env: PlatformEnv
  files: LibraryFiles
  tts: TtsApi
  clipboard: ClipboardApi
}
