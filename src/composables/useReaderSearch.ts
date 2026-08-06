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
  const offerOcr = ref(false)
  const ocrBusy = ref(false)
  const ocrProgress = ref<{ page: number; total: number } | null>(null)
  const searchProgress = ref<{ page: number; total: number } | null>(null)
  let searchAbort: AbortController | null = null

  async function runSearch(options?: { ocr?: boolean }) {
    const q = searchQuery.value.trim()
    if (!q) {
      searchHits.value = []
      searchFeedback.value = 'need-query'
      offerOcr.value = false
      opts.engine.value?.highlightSearch?.(null)
      return
    }
    const useOcr = Boolean(options?.ocr)
    searchBusy.value = true
    ocrBusy.value = useOcr
    searchFeedback.value = 'idle'
    offerOcr.value = false
    searchHits.value = []
    ocrProgress.value = useOcr ? { page: 0, total: 0 } : null
    searchProgress.value = null
    searchAbort?.abort()
    searchAbort = new AbortController()
    const signal = searchAbort.signal
    try {
      const final =
        (await opts.engine.value?.search?.(q, {
          ocr: useOcr,
          signal,
          onOcrProgress: (p) => {
            ocrProgress.value = p
          },
          onSearchProgress: (p) => {
            searchProgress.value = p
          },
          onHits: (hits) => {
            // Progressive: show matches as soon as pages yield them
            searchHits.value = hits
            if (hits.length && searchFeedback.value === 'idle') {
              searchFeedback.value = 'done'
              opts.engine.value?.highlightSearch?.(q)
            }
          },
        })) || []
      searchHits.value = final
      searchFeedback.value = 'done'
      if (final.length) {
        opts.engine.value?.highlightSearch?.(q)
        offerOcr.value = false
      } else {
        opts.engine.value?.highlightSearch?.(null)
        if (!useOcr && opts.engine.value?.capabilities.offlineOcr) {
          offerOcr.value = true
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        opts.flashStatus(useOcr ? '已取消 OCR' : '已取消搜索')
        return
      }
      console.error(err)
      searchHits.value = []
      searchFeedback.value = 'done'
      opts.engine.value?.highlightSearch?.(null)
      opts.flashStatus(useOcr ? '离线 OCR 失败' : '搜索失败')
    } finally {
      searchBusy.value = false
      ocrBusy.value = false
      ocrProgress.value = null
      searchProgress.value = null
      searchAbort = null
    }
  }

  function cancelOcr() {
    searchAbort?.abort()
  }

  function runOcrSearch() {
    return runSearch({ ocr: true })
  }

  function clearSearch() {
    cancelOcr()
    searchQuery.value = ''
    searchHits.value = []
    searchFeedback.value = 'idle'
    offerOcr.value = false
    ocrProgress.value = null
    searchProgress.value = null
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
    offerOcr,
    ocrBusy,
    ocrProgress,
    searchProgress,
    runSearch,
    runOcrSearch,
    cancelOcr,
    clearSearch,
    goHit,
    snippetHtml,
    resetHighlight,
  }
}
