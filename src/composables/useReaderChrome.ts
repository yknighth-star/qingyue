import { nextTick, ref, type Ref } from 'vue'

export type ReaderPanel = 'none' | 'toc' | 'annot' | 'settings' | 'search' | 'tts' | 'more'

export function useReaderChrome(opts?: {
  onPanelOpen?: (panel: ReaderPanel) => void
  searchInputRef?: Ref<HTMLInputElement | null>
}) {
  const chromeVisible = ref(true)
  const panel = ref<ReaderPanel>('none')

  function toggleChrome() {
    chromeVisible.value = !chromeVisible.value
  }

  function closePanel() {
    panel.value = 'none'
  }

  function openPanel(p: ReaderPanel) {
    panel.value = panel.value === p ? 'none' : p
    chromeVisible.value = true
    opts?.onPanelOpen?.(panel.value)
    if (panel.value === 'search' && opts?.searchInputRef) {
      void nextTick(() => opts.searchInputRef?.value?.focus())
    }
  }

  return {
    chromeVisible,
    panel,
    toggleChrome,
    closePanel,
    openPanel,
  }
}
