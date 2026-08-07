import type { AppearanceMode, DeviceClass, ReaderSettings, ThemeMode } from '@/types'

/** 宽屏双栏最小视口宽度（与设计稿一致） */
export const DUAL_COLUMN_MIN_WIDTH = 1100

export function detectDevice(): DeviceClass {
  const w = window.innerWidth
  if (w < 768) return 'phone'
  if (w < DUAL_COLUMN_MIN_WIDTH) return 'tablet'
  return 'desktop'
}

/** 当前小时是否落在定时深色区间（支持跨午夜，如 21–7） */
export function isInDarkSchedule(start: number, end: number, hour = new Date().getHours()): boolean {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end
}

export function prefersSystemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 手动主题里用作「白天底色」：深色则回退羊皮纸 */
export function daytimeTheme(theme: ThemeMode): ThemeMode {
  return theme === 'dark' ? 'sepia' : theme
}

export function effectiveTheme(settings: ReaderSettings, hour = new Date().getHours()): ThemeMode {
  const mode: AppearanceMode = settings.appearanceMode || 'manual'
  if (mode === 'system') {
    return prefersSystemDark() ? 'dark' : daytimeTheme(settings.theme)
  }
  if (mode === 'schedule') {
    return isInDarkSchedule(settings.autoDarkStart, settings.autoDarkEnd, hour)
      ? 'dark'
      : daytimeTheme(settings.theme)
  }
  return settings.theme
}

/** 排版面板外观说明文案 */
export function appearanceHint(settings: ReaderSettings, hour = new Date().getHours()): string {
  const mode = settings.appearanceMode || 'manual'
  if (mode === 'manual') return '使用上方选定的主题色'
  if (mode === 'system') {
    return prefersSystemDark() ? '已跟随系统：深色' : '已跟随系统：浅色（用白天主题）'
  }
  const { autoDarkStart: start, autoDarkEnd: end } = settings
  const inDark = isInDarkSchedule(start, end, hour)
  const range = `${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00`
  if (inDark) return `已按日程使用深色（${range}）`
  const hoursLeft = start > hour ? start - hour : 24 - hour + start
  return `将在 ${String(start).padStart(2, '0')}:00 切换深色（约 ${hoursLeft} 小时后）· ${range}`
}

export function dualColumnHint(opts: {
  format?: string
  pageTurn: string
  dualColumn: boolean
  wideEnough: boolean
}): string {
  if (opts.format === 'pdf') return ''
  if (opts.pageTurn === 'scroll') return '双栏仅在横滑 / 仿真下可用'
  if (!opts.wideEnough) return `需屏幕宽度 ≥ ${DUAL_COLUMN_MIN_WIDTH}px`
  return opts.dualColumn ? '大屏左右分栏，更接近纸书' : '开启后宽屏左右分栏'
}

export function autoScrollSpeedLabel(speed: number): string {
  if (speed <= 0) return '关闭'
  if (speed <= 2) return '慢'
  if (speed <= 5) return '中'
  return '快'
}

export const THEME_VARS: Record<ThemeMode, Record<string, string>> = {
  light: {
    '--reader-bg': '#f7f7f5',
    '--reader-fg': '#1c1c1c',
    '--reader-muted': '#6b6b6b',
    '--chrome-bg': 'rgba(247,247,245,0.92)',
  },
  dark: {
    '--reader-bg': '#12141a',
    '--reader-fg': '#e8e6e3',
    '--reader-muted': '#9a9a9a',
    '--chrome-bg': 'rgba(18,20,26,0.92)',
  },
  sepia: {
    '--reader-bg': '#f3ead3',
    '--reader-fg': '#3b2f2f',
    '--reader-muted': '#7a6a55',
    '--chrome-bg': 'rgba(243,234,211,0.94)',
  },
  green: {
    '--reader-bg': '#c7e0c7',
    '--reader-fg': '#1f2e1f',
    '--reader-muted': '#4d664d',
    '--chrome-bg': 'rgba(199,224,199,0.94)',
  },
}

export function applyThemeVars(el: HTMLElement, theme: ThemeMode, settings: ReaderSettings) {
  const vars = THEME_VARS[theme]
  Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v))
  el.style.setProperty('--reader-font-size', `${settings.fontSize}px`)
  el.style.setProperty('--reader-line-height', String(settings.lineHeight))
  el.style.setProperty('--reader-font', settings.fontFamily)
  el.style.setProperty('--reader-margin-x', `${settings.marginX}px`)
  el.style.setProperty('--reader-margin-y', `${settings.marginY}px`)
  el.style.setProperty('--reader-para-gap', `${settings.paragraphGap}em`)
  el.style.setProperty('--reader-indent', `${settings.indent}em`)
  el.style.filter = settings.brightness < 1 ? `brightness(${settings.brightness})` : ''
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatPercent(n: number): string {
  return `${Math.min(100, Math.max(0, Math.round(n)))}%`
}

/** Chrome label: `128 / 520`, `约 12 / 80`, or percent fallback. */
export function formatPageLabel(p: {
  percent: number
  page?: number
  pageCount?: number
  pageMode?: 'exact' | 'estimate' | 'chapter'
}): string {
  const page = p.page
  const total = p.pageCount
  if (!page || !total || page < 1 || total < 1) return formatPercent(p.percent)
  const pair = `${page} / ${total}`
  if (p.pageMode === 'estimate') return `约 ${pair}`
  if (p.pageMode === 'chapter') return `本节 ${pair}`
  return pair
}
