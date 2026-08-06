export type BookFormat = 'epub' | 'txt' | 'pdf'
export type StorageKind = 'idb' | 'fs'
export type ShelfFilter = 'all' | 'favorite' | 'recent'
export type FormatFilter = 'all' | BookFormat
export type ProgressFilter = 'all' | 'unread' | 'reading' | 'done'
export type ShelfSort = 'activity' | 'added' | 'title' | 'author'
export type AnnotType = 'highlight' | 'note' | 'bookmark'
export type ThemeMode = 'light' | 'dark' | 'sepia' | 'green'
export type PageTurnMode = 'scroll' | 'slide' | 'curl'
export type DeviceClass = 'phone' | 'tablet' | 'desktop'

export interface BookRecord {
  id: string
  title: string
  author: string
  format: BookFormat
  cover?: Blob
  fileSize: number
  storage: StorageKind
  fsPath?: string
  addedAt: number
  lastReadAt?: number
  isFavorite: boolean
  progressPercent: number
  tags: string[]
  contentHash?: string
}

export interface BookFileRecord {
  bookId: string
  blob: Blob
  name: string
}

export interface FsRootRecord {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  linkedAt: number
}

export type Locator =
  | { type: 'txt'; chapterId: number; offset: number; charOffset: number }
  | { type: 'epub'; cfi?: string; spineIndex: number; href?: string; offset?: number }
  | { type: 'pdf'; page: number; yRatio: number }

export interface ProgressRecord {
  bookId: string
  locator: Locator
  percent: number
  updatedAt: number
}

export interface AnnotationRecord {
  id: string
  bookId: string
  type: AnnotType
  color: string
  selectedText?: string
  note?: string
  locator: Locator
  createdAt: number
}

export interface ReaderSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  paragraphGap: number
  marginX: number
  marginY: number
  indent: number
  theme: ThemeMode
  pageTurn: PageTurnMode
  brightness: number
  autoScrollSpeed: number
  dualColumn: boolean
  ttsRate: number
  /** Speech pitch 0.5–2 (1 = default) */
  ttsPitch: number
  /** speechSynthesis voiceURI; empty = auto-pick best Chinese voice */
  ttsVoiceURI: string
  autoDark: boolean
  autoDarkStart: number
  autoDarkEnd: number
}

export interface TocItem {
  id: string
  label: string
  locator: Locator
  children?: TocItem[]
}

export interface SearchHit {
  snippet: string
  locator: Locator
}

export interface StatsDay {
  date: string
  minutes: number
}

export interface StatsBook {
  bookId: string
  minutes: number
}

export interface StatsRecord {
  id: 'global'
  totalMinutes: number
  streakDays: number
  lastActiveDate?: string
  byDay: StatsDay[]
  byBook: StatsBook[]
}

export const HIGHLIGHT_COLORS = ['#ffe566', '#ff9aa2', '#a0e7e5', '#b5eada', '#c9b1ff']

/** Friendly body font presets (label → CSS font-family stack) */
export const FONT_PRESETS: { id: string; label: string; value: string }[] = [
  {
    id: 'serif',
    label: '宋体',
    value: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", SimSun, Georgia, serif',
  },
  {
    id: 'sans',
    label: '黑体',
    value: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'kai',
    label: '楷体',
    value: '"Kaiti SC", KaiTi, STKaiti, "Songti SC", serif',
  },
  {
    id: 'fangsong',
    label: '仿宋',
    value: '"FangSong SC", FangSong, STFangsong, serif',
  },
  {
    id: 'system',
    label: '系统',
    value: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'en-serif',
    label: '英文衬线',
    value: 'Georgia, "Times New Roman", Times, serif',
  },
]

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  fontFamily: FONT_PRESETS[0].value,
  lineHeight: 1.75,
  paragraphGap: 0.8,
  marginX: 24,
  marginY: 20,
  indent: 2,
  theme: 'sepia',
  pageTurn: 'slide',
  brightness: 1,
  autoScrollSpeed: 0,
  dualColumn: false,
  ttsRate: 1,
  ttsPitch: 1,
  ttsVoiceURI: '',
  autoDark: false,
  autoDarkStart: 21,
  autoDarkEnd: 7,
}

export const MAX_IDB_FILE_BYTES = 200 * 1024 * 1024
