import type { DeviceClass, ReaderSettings, ThemeMode } from '@/types'

export function detectDevice(): DeviceClass {
  const w = window.innerWidth
  if (w < 768) return 'phone'
  if (w < 1100) return 'tablet'
  return 'desktop'
}

export function effectiveTheme(settings: ReaderSettings): ThemeMode {
  if (!settings.autoDark) return settings.theme
  const h = new Date().getHours()
  const { autoDarkStart: start, autoDarkEnd: end } = settings
  const inDark = start > end ? h >= start || h < end : h >= start && h < end
  return inDark ? 'dark' : settings.theme
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
