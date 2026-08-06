import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import { DEFAULT_SETTINGS, FONT_PRESETS, type ReaderSettings } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<ReaderSettings>({ ...DEFAULT_SETTINGS })

  async function load() {
    const row = await db.settings.get('reader')
    if (row) {
      const { id: _id, ...rest } = row as ReaderSettings & { id: string }
      const merged = { ...DEFAULT_SETTINGS, ...rest }
      // Map legacy raw CSS font strings onto a known preset when possible
      if (!FONT_PRESETS.some((f) => f.value === merged.fontFamily)) {
        const raw = merged.fontFamily.toLowerCase()
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
        if (hit) merged.fontFamily = hit.value
        else merged.fontFamily = DEFAULT_SETTINGS.fontFamily
      }
      settings.value = merged
    } else {
      await db.settings.put({ id: 'reader', ...DEFAULT_SETTINGS })
    }
  }

  async function update(patch: Partial<ReaderSettings>) {
    settings.value = { ...settings.value, ...patch }
    await db.settings.put({ id: 'reader', ...settings.value })
  }

  return { settings, load, update }
})
