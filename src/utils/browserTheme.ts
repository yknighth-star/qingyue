/** Default chrome for shelf / app shell (matches tokens + PWA manifest). */
export const APP_THEME_COLOR = '#1a1f2e'

/**
 * Keep mobile browser toolbar / status tint in sync with the visible page.
 * Android Chrome reads `<meta name="theme-color">`; also set `color-scheme`
 * so form controls and overscroll match light/dark reader themes.
 */
export function setBrowserThemeColor(
  color: string,
  colorScheme: 'light' | 'dark' = 'dark',
) {
  if (typeof document === 'undefined') return
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  if (meta.content !== color) meta.content = color
  document.documentElement.style.colorScheme = colorScheme
  document.documentElement.style.backgroundColor = color
}

export function resetBrowserThemeColor() {
  setBrowserThemeColor(APP_THEME_COLOR, 'dark')
}

export function themeColorScheme(mode: 'light' | 'dark' | 'sepia' | 'green'): 'light' | 'dark' {
  return mode === 'dark' ? 'dark' : 'light'
}
