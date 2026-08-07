<script setup lang="ts">
import { onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import { useBooksStore } from '@/stores/books'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { resetBrowserThemeColor } from '@/utils/browserTheme'

const settings = useSettingsStore()
const stats = useStatsStore()
const books = useBooksStore()

onMounted(async () => {
  resetBrowserThemeColor()
  try {
    await settings.load()
    await stats.load()
    await books.refresh()
  } catch (err) {
    console.warn('App boot failed', err)
  }
})
</script>

<template>
  <router-view />
  <ConfirmDialog />
</template>
