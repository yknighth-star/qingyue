import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { ReaderSettings, ThemeMode } from '@/types'
import { effectiveTheme, THEME_VARS } from '@/utils/format'

/**
 * Appearance theme tick (system / schedule) + CSS vars on the reader page root.
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
    const el = opts.pageRef.value
    if (!el) return
    const vars = THEME_VARS[themeMode.value]
    Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v))
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
  })

  return {
    themeTick,
    themeMode,
    bumpThemeTick,
    syncPageTheme,
    onAppearanceModeChange,
  }
}
