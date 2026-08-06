import { computed, ref, type Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { SelectionCaptureEvent } from '@/engines/types'
import { useBooksStore } from '@/stores/books'
import type { AnnotationRecord, BookRecord, Locator } from '@/types'
import { uid } from '@/storage/types'
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/utils/export'
import { getDictionaryProvider } from '@/utils/dictionary'
import { placeToolbarAboveRect } from '@/utils/selectionToolbar'
import { getPlatform } from '@/platform'

export function useSelectionAnnot(opts: {
  book: Ref<BookRecord | null>
  engine: Ref<ReaderEngine | null>
  flashStatus: (msg: string) => void
  closePanel: () => void
}) {
  const books = useBooksStore()
  const platform = getPlatform()
  const annots = ref<AnnotationRecord[]>([])
  const selectionBar = ref<{
    left: number
    top: number
    text: string
    locator: Locator
  } | null>(null)
  const noteDraft = ref('')
  const dictResult = ref<string | null>(null)
  let ignoreTapUntil = 0

  const annotUiActive = computed(() => Boolean(selectionBar.value))

  function getIgnoreTapUntil() {
    return ignoreTapUntil
  }

  function openSelectionBarFromEvent(ev: SelectionCaptureEvent) {
    const text = ev.text.trim()
    if (!text) return
    const barW = 280
    const barH = 44
    const pos = placeToolbarAboveRect(ev.rect, barW, barH)
    selectionBar.value = {
      left: pos.left,
      top: pos.top,
      text,
      locator: ev.locator,
    }
    ignoreTapUntil = Date.now() + 450
  }

  function clearSelectionBar() {
    selectionBar.value = null
    noteDraft.value = ''
    window.setTimeout(() => {
      try {
        window.getSelection()?.removeAllRanges()
      } catch {
        /* */
      }
    }, 0)
  }

  function hasTextSelection() {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.toString().trim()) return true
    return Boolean(opts.engine.value?.captureSelection?.()?.text)
  }

  function shouldBlockTapActions() {
    if (Date.now() < ignoreTapUntil) return true
    if (selectionBar.value) return true
    return hasTextSelection()
  }

  function onEngineSelection(ev: SelectionCaptureEvent | null) {
    if (!ev?.text) return
    openSelectionBarFromEvent(ev)
  }

  function onPointerUp() {
    window.setTimeout(() => {
      if (selectionBar.value) return
      const cap = opts.engine.value?.captureSelection?.()
      if (!cap?.text) return
      const rect = cap.rect || {
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
    }, 60)
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

  async function addHighlight(color: string) {
    if (!selectionBar.value || !opts.book.value) return
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
      color,
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
      opts.flashStatus('已保存笔记')
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
    await books.addAnnotation(annot)
    annots.value = await books.listAnnotations(opts.book.value.id)
    opts.engine.value.applyAnnotations?.(annots.value)
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
    dictResult.value = res ? `${res.word}：${res.meanings.join('；')}` : '未找到释义'
    clearSelectionBar()
  }

  function getSpeakText() {
    return selectionBar.value?.text || opts.engine.value?.getSelectableText?.() || ''
  }

  return {
    annots,
    selectionBar,
    noteDraft,
    dictResult,
    annotUiActive,
    getIgnoreTapUntil,
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
