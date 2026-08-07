import { computed, ref, watch, type Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { SelectionCaptureEvent } from '@/engines/types'
import { useBooksStore } from '@/stores/books'
import type { AnnotationRecord, BookRecord, Locator } from '@/types'
import { HIGHLIGHT_COLORS } from '@/types'
import { uid } from '@/storage/types'
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/utils/export'
import { getDictionaryProvider, formatDictionaryResult } from '@/utils/dictionary'
import { placeToolbarAboveRect } from '@/utils/selectionToolbar'
import { getPlatform } from '@/platform'
import type { MarkHandleRects } from '@/utils/markSelect'

export function useSelectionAnnot(opts: {
  book: Ref<BookRecord | null>
  engine: Ref<ReaderEngine | null>
  flashStatus: (msg: string) => void
  closePanel: () => void
  /** 当前划线色；保存时写入并记住 */
  getHighlightColor: () => string
  setHighlightColor?: (color: string) => void
}) {
  const books = useBooksStore()
  const platform = getPlatform()
  const annots = ref<AnnotationRecord[]>([])
  /** 划线模式：长按进入，点关闭 / 保存后才退出 */
  const markMode = ref(false)
  const selectionBar = ref<{
    left: number
    top: number
    text: string
    locator: Locator
  } | null>(null)
  /** 华为式两端手柄（父视口坐标） */
  const markHandles = ref<MarkHandleRects | null>(null)
  const noteDraft = ref('')
  const dictResult = ref<string | null>(null)
  let ignoreTapUntil = 0
  let bodyDragging = false
  let handleDragging: 'start' | 'end' | null = null

  const annotUiActive = computed(() => markMode.value || Boolean(selectionBar.value))

  watch(markMode, (active) => {
    opts.engine.value?.setSelectMode?.(active)
    if (!active) markHandles.value = null
  })

  function getIgnoreTapUntil() {
    return ignoreTapUntil
  }

  function syncHandles(rects: MarkHandleRects | null | undefined) {
    markHandles.value = rects ?? opts.engine.value?.getMarkHandleRects?.() ?? null
  }

  function refreshBarFromCapture() {
    const eng = opts.engine.value
    if (!eng || !markMode.value) return
    const cap = eng.captureSelection?.()
    if (!cap?.text) {
      selectionBar.value = null
      syncHandles(null)
      return
    }
    const rect = cap.rect || eng.getMarkHandleRects?.()?.union || {
      top: window.innerHeight / 3,
      left: window.innerWidth / 2 - 40,
      bottom: window.innerHeight / 3 + 20,
      right: window.innerWidth / 2 + 40,
    }
    openSelectionBarFromEvent({
      text: cap.text,
      locator: cap.locator,
      clientX: (rect.left + rect.right) / 2,
      clientY: rect.top,
      rect,
    })
    syncHandles(eng.getMarkHandleRects?.() ?? null)
  }

  function enterMarkMode(flash = true) {
    if (!markMode.value) {
      markMode.value = true
      opts.engine.value?.setSelectMode?.(true)
      if (flash) opts.flashStatus('划线模式：拖选文字，拖绿点可调范围')
    }
    ignoreTapUntil = Date.now() + 200
  }

  function openSelectionBarFromEvent(ev: SelectionCaptureEvent) {
    const text = ev.text.trim()
    if (!text) return
    if (bodyDragging || handleDragging) return
    markMode.value = true
    opts.engine.value?.setSelectMode?.(true)
    const barW = 280
    const barH = 92
    const pos = placeToolbarAboveRect(ev.rect, barW, barH)
    selectionBar.value = {
      left: pos.left,
      top: pos.top,
      text,
      locator: ev.locator,
    }
    syncHandles(opts.engine.value?.getMarkHandleRects?.() ?? null)
    ignoreTapUntil = Date.now() + 200
  }

  /** 退出划线模式（仅关闭 / 保存） */
  function clearSelectionBar() {
    bodyDragging = false
    handleDragging = null
    markMode.value = false
    selectionBar.value = null
    markHandles.value = null
    noteDraft.value = ''
    opts.engine.value?.setSelectMode?.(false)
    opts.engine.value?.clearNativeSelection?.()
    window.setTimeout(() => {
      try {
        window.getSelection()?.removeAllRanges()
      } catch {
        /* */
      }
    }, 0)
  }

  /** 正文拖选开始（划线模式） */
  function onMarkBodyDown(clientX: number, clientY: number) {
    if (!markMode.value) return false
    const eng = opts.engine.value
    if (!eng?.markDrag) return false
    bodyDragging = true
    handleDragging = null
    selectionBar.value = null
    const rects = eng.markDrag('start', clientX, clientY)
    syncHandles(rects)
    // 长按落点立刻有一字选区时也要亮出手柄
    if (!rects) {
      window.requestAnimationFrame(() => {
        syncHandles(eng.getMarkHandleRects?.() ?? null)
      })
    }
    return true
  }

  function onMarkBodyMove(clientX: number, clientY: number) {
    if (!bodyDragging || !markMode.value) return
    const rects = opts.engine.value?.markDrag?.('move', clientX, clientY)
    syncHandles(rects)
  }

  function onMarkBodyUp() {
    if (!bodyDragging) return
    bodyDragging = false
    opts.engine.value?.markDrag?.('end', 0, 0)
    refreshBarFromCapture()
  }

  function onMarkHandleStart(which: 'start' | 'end', clientX: number, clientY: number) {
    if (!markMode.value) return
    handleDragging = which
    bodyDragging = false
    selectionBar.value = null
    const rects = opts.engine.value?.markHandle?.('start', which, clientX, clientY)
    syncHandles(rects)
  }

  function onMarkHandleMove(clientX: number, clientY: number) {
    if (!handleDragging) return
    const rects = opts.engine.value?.markHandle?.('move', handleDragging, clientX, clientY)
    syncHandles(rects)
  }

  function onMarkHandleEnd() {
    if (!handleDragging) return
    const which = handleDragging
    handleDragging = null
    opts.engine.value?.markHandle?.('end', which, 0, 0)
    refreshBarFromCapture()
  }

  function hasTextSelection() {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.toString().trim()) return true
    return Boolean(opts.engine.value?.captureSelection?.()?.text)
  }

  function shouldBlockTapActions() {
    if (Date.now() < ignoreTapUntil) return true
    if (markMode.value || selectionBar.value) return true
    return hasTextSelection()
  }

  function onEngineSelection(ev: SelectionCaptureEvent | null) {
    if (!ev?.text) return
    if (bodyDragging || handleDragging) return
    openSelectionBarFromEvent(ev)
  }

  function onLongPress() {
    enterMarkMode(true)
  }

  function onPointerUp() {
    if (bodyDragging) {
      onMarkBodyUp()
      return
    }
    if (!markMode.value) return
    window.setTimeout(() => {
      if (!markMode.value || bodyDragging || handleDragging) return
      refreshBarFromCapture()
    }, 40)
  }

  async function copySelection() {
    const text = selectionBar.value?.text
    if (!text) return
    const ok = await platform.clipboard.writeText(text)
    opts.flashStatus(ok ? '已复制' : '复制失败')
  }

  async function loadAnnotations(bookId: string) {
    annots.value = await books.listAnnotations(bookId)
    opts.engine.value?.applyAnnotations?.(annots.value)
  }

  async function addHighlight(color?: string) {
    if (!selectionBar.value || !opts.book.value) return
    const fromSettings = opts.getHighlightColor()
    const resolved =
      color && HIGHLIGHT_COLORS.includes(color)
        ? color
        : HIGHLIGHT_COLORS.includes(fromSettings)
          ? fromSettings
          : HIGHLIGHT_COLORS[0]
    opts.setHighlightColor?.(resolved)
    const bar = selectionBar.value
    const live = opts.engine.value?.captureSelection?.()
    let locator = bar.locator
    if (live?.text && live.locator) {
      if (live.locator.type === 'epub' && live.locator.cfi) locator = live.locator
      else if (live.locator.type !== 'epub') locator = live.locator
    }
    if (locator.type === 'epub' && !locator.cfi) {
      opts.flashStatus('无法定位笔记位置，请重新拖选后再试')
      return
    }
    const annot: AnnotationRecord = {
      id: uid('ann'),
      bookId: opts.book.value.id,
      type: 'highlight',
      color: resolved,
      selectedText: bar.text,
      note: noteDraft.value || undefined,
      locator,
      createdAt: Date.now(),
    }
    try {
      await books.addAnnotation(annot)
      annots.value = await books.listAnnotations(opts.book.value.id)
      opts.engine.value?.applyAnnotations?.(annots.value)
      clearSelectionBar()
      opts.flashStatus('已保存划线')
    } catch (err) {
      console.error(err)
      opts.flashStatus('笔记保存失败')
    }
  }

  async function addBookmark() {
    if (!opts.book.value || !opts.engine.value) return
    const p = opts.engine.value.getProgress()
    const annot: AnnotationRecord = {
      id: uid('ann'),
      bookId: opts.book.value.id,
      type: 'bookmark',
      color: '#c4a574',
      locator: p.locator,
      createdAt: Date.now(),
    }
    try {
      await books.addAnnotation(annot)
      annots.value = await books.listAnnotations(opts.book.value.id)
      opts.engine.value.applyAnnotations?.(annots.value)
      opts.closePanel()
      opts.flashStatus('已添加书签')
    } catch {
      opts.flashStatus('添加书签失败')
    }
  }

  async function removeAnnot(id: string) {
    await books.removeAnnotation(id)
    if (opts.book.value) {
      annots.value = await books.listAnnotations(opts.book.value.id)
      opts.engine.value?.applyAnnotations?.(annots.value)
    }
  }

  async function goAnnot(a: AnnotationRecord) {
    await opts.engine.value?.goTo(a.locator)
    opts.closePanel()
  }

  function exportAnnots(kind: 'md' | 'json') {
    if (!opts.book.value) return
    if (kind === 'md') {
      downloadText(
        `${opts.book.value.title}-annotations.md`,
        annotationsToMarkdown(opts.book.value, annots.value),
        'text/markdown',
      )
    } else {
      downloadText(
        `${opts.book.value.title}-annotations.json`,
        annotationsToJson(opts.book.value, annots.value),
        'application/json',
      )
    }
  }

  async function lookupWord() {
    const word = selectionBar.value?.text?.trim() || ''
    if (!word) return
    const res = await getDictionaryProvider().lookup(word.slice(0, 32))
    dictResult.value = res ? formatDictionaryResult(res) : '未找到释义'
    clearSelectionBar()
  }

  function getSpeakText() {
    return selectionBar.value?.text || opts.engine.value?.getSelectableText?.() || ''
  }

  return {
    annots,
    markMode,
    markHandles,
    selectionBar,
    noteDraft,
    dictResult,
    annotUiActive,
    getIgnoreTapUntil,
    enterMarkMode,
    onMarkBodyDown,
    onMarkBodyMove,
    onMarkBodyUp,
    onMarkHandleStart,
    onMarkHandleMove,
    onMarkHandleEnd,
    onLongPress,
    openSelectionBarFromEvent,
    clearSelectionBar,
    hasTextSelection,
    shouldBlockTapActions,
    onEngineSelection,
    onPointerUp,
    copySelection,
    loadAnnotations,
    addHighlight,
    addBookmark,
    removeAnnot,
    goAnnot,
    exportAnnots,
    lookupWord,
    getSpeakText,
  }
}
