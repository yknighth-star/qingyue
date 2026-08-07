import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { ReaderSettings, ThemeMode } from '@/types'
import { resetBrowserThemeColor, setBrowserThemeColor, themeColorScheme } from '@/utils/browserTheme'
import { effectiveTheme, THEME_VARS } from '@/utils/format'

/**
 * Appearance theme tick (system / schedule) + CSS vars on the reader page root.
 * Also syncs mobile browser `theme-color` so the address bar matches reader bg.
 */
export function useReaderTheme(opts: {
  settings: () => ReaderSettings
  pageRef: Ref<HTMLElement | null>
  onAppearanceModeFlash?: (mode: ReaderSettings['appearanceMode']) => void
}) {
  /** Bumps so schedule/system appearance recomputes without settings change */
  const themeTick = ref(0)
  let themeTickTimer: number | null = null
  let systemColorMql: MediaQueryList | null = null

  const themeMode = computed((): ThemeMode => {
    void themeTick.value
    return effectiveTheme(opts.settings())
  })

  function bumpThemeTick() {
    themeTick.value += 1
  }

  function onSystemColorScheme() {
    if (opts.settings().appearanceMode === 'system') bumpThemeTick()
  }

  function syncPageTheme() {
    const mode = themeMode.value
    const vars = THEME_VARS[mode]
    const el = opts.pageRef.value
    if (el) {
      Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v))
      // Mirror onto page root so chrome / safe-area match immediately.
      el.style.backgroundColor = vars['--reader-bg'] || ''
      el.style.color = vars['--reader-fg'] || ''
    }
    const bg = vars['--reader-bg']
    if (bg) setBrowserThemeColor(bg, themeColorScheme(mode))
  }

  function onAppearanceModeChange(
    mode: ReaderSettings['appearanceMode'],
    prev: ReaderSettings['appearanceMode'] | undefined,
  ) {
    if (!prev || mode === prev) return
    opts.onAppearanceModeFlash?.(mode)
    bumpThemeTick()
  }

  onMounted(() => {
    systemColorMql = window.matchMedia('(prefers-color-scheme: dark)')
    systemColorMql.addEventListener('change', onSystemColorScheme)
    themeTickTimer = window.setInterval(bumpThemeTick, 60_000)
  })

  onBeforeUnmount(() => {
    systemColorMql?.removeEventListener('change', onSystemColorScheme)
    systemColorMql = null
    if (themeTickTimer) window.clearInterval(themeTickTimer)
    themeTickTimer = null
    resetBrowserThemeColor()
  })

  return {
    themeTick,
    themeMode,
    bumpThemeTick,
    syncPageTheme,
    onAppearanceModeChange,
  }
}
