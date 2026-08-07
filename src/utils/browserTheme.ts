/** Default chrome for shelf / app shell (matches tokens + PWA manifest). */
export const APP_THEME_COLOR = '#1a1f2e'

/**
 * Keep mobile browser toolbar / status tint in sync with the visible page.
 * Android Chrome often ignores in-place `content` updates — remount the meta tag.
 */
export function setBrowserThemeColor(
  color: string,
  colorScheme: 'light' | 'dark' = 'dark',
) {
  if (typeof document === 'undefined') return

  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove())
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  document.head.appendChild(meta)

  const root = document.documentElement
  root.style.colorScheme = colorScheme
  root.style.backgroundColor = color
  // Overscroll / rubber-band areas follow body on many mobile browsers.
  document.body.style.backgroundColor = color
}

export function resetBrowserThemeColor() {
  setBrowserThemeColor(APP_THEME_COLOR, 'dark')
}

export function themeColorScheme(mode: 'light' | 'dark' | 'sepia' | 'green'): 'light' | 'dark' {
  return mode === 'dark' ? 'dark' : 'light'
}
