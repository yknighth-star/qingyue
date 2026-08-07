import { db } from '@/db'
import { DEFAULT_SETTINGS, FONT_PRESETS, type AppearanceMode, type ReaderSettings } from '@/types'
import { cloneForIdb } from '@/utils/idbClone'

function normalizeFontFamily(fontFamily: string): string {
  if (FONT_PRESETS.some((f) => f.value === fontFamily)) return fontFamily
  const raw = fontFamily.toLowerCase()
  const hit =
    FONT_PRESETS.find((f) => raw.includes(f.id) || raw.includes(f.label)) ||
    (raw.includes('serif') || raw.includes('song') || raw.includes('georgia')
      ? FONT_PRESETS[0]
      : raw.includes('sans') || raw.includes('yahei') || raw.includes('pingfang')
        ? FONT_PRESETS[1]
        : raw.includes('kai')
          ? FONT_PRESETS[2]
          : raw.includes('fang')
            ? FONT_PRESETS[3]
            : undefined)
  return hit?.value ?? DEFAULT_SETTINGS.fontFamily
}

function normalizeAppearance(raw: ReaderSettings & { autoDark?: boolean }): AppearanceMode {
  const mode = raw.appearanceMode
  if (mode === 'manual' || mode === 'system' || mode === 'schedule') return mode
  return raw.autoDark ? 'schedule' : 'manual'
}

export const settingsRepo = {
  async load(): Promise<ReaderSettings> {
    const row = await db.settings.get('reader')
    if (!row) {
      await db.settings.put({ id: 'reader', ...DEFAULT_SETTINGS })
      return { ...DEFAULT_SETTINGS }
    }
    const { id: _id, ...rest } = row as ReaderSettings & { id: string; autoDark?: boolean }
    const merged = { ...DEFAULT_SETTINGS, ...rest }
    merged.fontFamily = normalizeFontFamily(merged.fontFamily)
    merged.appearanceMode = normalizeAppearance(merged as ReaderSettings & { autoDark?: boolean })
    delete (merged as { autoDark?: boolean }).autoDark
    return merged
  },

  async save(settings: ReaderSettings): Promise<void> {
    const { autoDark: _legacy, ...clean } = settings as ReaderSettings & { autoDark?: boolean }
    await db.settings.put(cloneForIdb({ id: 'reader', ...clean }))
  },
}
