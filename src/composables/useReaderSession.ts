import { markRaw, nextTick, ref, shallowRef, type Ref } from 'vue'
import { createEngine } from '@/engines/factory'
import type { ReaderEngine } from '@/engines/types'
import type { ContentTapEvent, SelectionCaptureEvent } from '@/engines/types'
import { useBooksStore } from '@/stores/books'
import { useSettingsStore } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import type { BookRecord, Locator, TocItem } from '@/types'

export function useReaderSession(opts: {
  bookId: string
  host: Ref<HTMLElement | null>
  onWheel: (deltaY: number) => void
  onContentTap: (ev: ContentTapEvent) => void
  onSelection: (ev: SelectionCaptureEvent | null) => void
}) {
  const books = useBooksStore()
  const settingsStore = useSettingsStore()
  const stats = useStatsStore()

  const book = ref<BookRecord | null>(null)
  // Engines use TS private fields — must not be deep-proxied by Vue
  const engine = shallowRef<ReaderEngine | null>(null)
  const percent = ref(0)
  const toc = ref<TocItem[]>([])
  const opening = ref(true)
  const openHint = ref('正在打开…')
  const error = ref('')
  let progressTimer: number | null = null
  /** False until initial locator restore finishes — avoids writing ~0% over a saved position. */
  let progressSaveEnabled = false

  function scheduleSave(locator: Locator, pct: number) {
    if (!progressSaveEnabled) return
    if (progressTimer) window.clearTimeout(progressTimer)
    progressTimer = window.setTimeout(() => {
      if (book.value) void books.saveProgress(book.value.id, locator, pct)
    }, 800)
  }

  function flushProgress() {
    if (!engine.value || !book.value || !progressSaveEnabled) return
    const p = engine.value.getProgress()
    void books.saveProgress(book.value.id, p.locator, p.percent)
  }

  function enableProgressSave() {
    progressSaveEnabled = true
  }

  async function open() {
    error.value = ''
    opening.value = true
    openHint.value = '正在读取文件…'
    try {
      await books.refresh()
      await settingsStore.load()
      const b = books.books.find((x) => x.id === opts.bookId) || null
      book.value = b
      if (!b) {
        error.value = '未找到文件'
        return
      }
      openHint.value = '正在加载文件数据…'
      const blob = await books.getBlob(b.id)
      if (!blob) {
        error.value = b.storage === 'fs' ? '无法读取，请重新关联目录' : '书籍缺失'
        return
      }

      openHint.value =
        b.format === 'pdf'
          ? '正在解析 PDF（优先显示首页）…'
          : b.format === 'epub'
            ? '正在解析 EPUB…'
            : '正在加载文本…'

      const eng = createEngine(b.format)
      await nextTick()
      if (!opts.host.value) {
        error.value = '阅读器容器未就绪，请刷新重试'
        return
      }
      await eng.open(blob, settingsStore.settings, opts.host.value)
      opening.value = false

      eng.onProgress?.((p) => {
        percent.value = p.percent
        scheduleSave(p.locator, p.percent)
      })
      eng.onWheel?.(opts.onWheel)
      eng.onContentTap?.(opts.onContentTap)
      eng.onSelection?.(opts.onSelection)
      engine.value = markRaw(eng)
      toc.value = eng.getToc()
      percent.value = eng.getProgress().percent
      // Mark opened without overwriting a higher saved percent (page 1 ≈ 0%)
      void books.touchOpened(b.id)

      stats.startSession(b.id)
      return { book: b, engine: eng }
    } catch (err) {
      console.error(err)
      error.value = err instanceof Error ? `打开失败：${err.message}` : '打开文件失败'
      engine.value?.destroy()
      engine.value = null
      return null
    } finally {
      opening.value = false
    }
  }

  function destroy() {
    flushProgress()
    void stats.endSession()
    engine.value?.destroy()
    engine.value = null
    if (progressTimer) {
      window.clearTimeout(progressTimer)
      progressTimer = null
    }
  }

  function applySettings() {
    engine.value?.applySettings(settingsStore.settings)
  }

  return {
    book,
    engine,
    percent,
    toc,
    opening,
    openHint,
    error,
    open,
    destroy,
    flushProgress,
    enableProgressSave,
    applySettings,
    scheduleSave,
  }
}
