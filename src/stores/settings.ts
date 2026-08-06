import { defineStore } from 'pinia'
import { ref } from 'vue'
import { settingsRepo } from '@/repos'
import { DEFAULT_SETTINGS, type ReaderSettings } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<ReaderSettings>({ ...DEFAULT_SETTINGS })

  async function load() {
    settings.value = await settingsRepo.load()
  }

  async function update(patch: Partial<ReaderSettings>) {
    settings.value = { ...settings.value, ...patch }
    await settingsRepo.save(settings.value)
  }

  return { settings, load, update }
})
