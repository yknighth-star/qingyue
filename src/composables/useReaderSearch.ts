import { nextTick, ref, type Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { SearchHit } from '@/types'
import { markQueryInSnippet } from '@/utils/domHighlight'

export function useReaderSearch(opts: {
  engine: Ref<ReaderEngine | null>
  flashStatus: (msg: string) => void
  closePanel: () => void
}) {
  const searchQuery = ref('')
  const searchHits = ref<SearchHit[]>([])
  const searchBusy = ref(false)
  const searchFeedback = ref<'idle' | 'need-query' | 'done'>('idle')
  const searchInputRef = ref<HTMLInputElement | null>(null)

  async function runSearch() {
    const q = searchQuery.value.trim()
    if (!q) {
      searchHits.value = []
      searchFeedback.value = 'need-query'
      opts.engine.value?.highlightSearch?.(null)
      return
    }
    searchBusy.value = true
    searchFeedback.value = 'idle'
    try {
      searchHits.value = (await opts.engine.value?.search?.(q)) || []
      searchFeedback.value = 'done'
      if (searchHits.value.length) opts.engine.value?.highlightSearch?.(q)
      else opts.engine.value?.highlightSearch?.(null)
    } catch (err) {
      console.error(err)
      searchHits.value = []
      searchFeedback.value = 'done'
      opts.engine.value?.highlightSearch?.(null)
      opts.flashStatus('搜索失败')
    } finally {
      searchBusy.value = false
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    searchHits.value = []
    searchFeedback.value = 'idle'
    opts.engine.value?.highlightSearch?.(null)
    void nextTick(() => searchInputRef.value?.focus())
  }

  async function goHit(hit: SearchHit) {
    const q = searchQuery.value.trim()
    await opts.engine.value?.goTo(hit.locator)
    opts.engine.value?.highlightSearch?.(q || null)
    opts.closePanel()
    if (q) opts.flashStatus(`已定位：${q}`)
  }

  function snippetHtml(snippet: string) {
    return markQueryInSnippet(snippet, searchQuery.value)
  }

  function resetHighlight() {
    opts.engine.value?.highlightSearch?.(null)
  }

  return {
    searchQuery,
    searchHits,
    searchBusy,
    searchFeedback,
    searchInputRef,
    runSearch,
    clearSearch,
    goHit,
    snippetHtml,
    resetHighlight,
  }
}
