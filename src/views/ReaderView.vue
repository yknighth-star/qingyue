<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBooksStore } from '@/stores/books'
import { useSettingsStore } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import { TxtEngine } from '@/engines/txtEngine'
import { EpubEngine } from '@/engines/epubEngine'
import { PdfEngine } from '@/engines/pdfEngine'
import type { ReaderEngine } from '@/engines/types'
import {
  FONT_PRESETS,
  HIGHLIGHT_COLORS,
  type AnnotationRecord,
  type BookRecord,
  type Locator,
  type SearchHit,
  type TocItem,
} from '@/types'
import { uid } from '@/storage/types'
import { detectDevice, effectiveTheme, formatPercent, THEME_VARS } from '@/utils/format'
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/utils/export'
import { createTts, pickVoice, voiceIdOf } from '@/utils/tts'
import { confirmDialog } from '@/composables/useConfirm'
import { getDictionaryProvider } from '@/utils/dictionary'
import type { ContentTapEvent, SelectionCaptureEvent } from '@/engines/types'
import { markQueryInSnippet } from '@/utils/domHighlight'
import { placeToolbarAboveRect } from '@/utils/selectionToolbar'
import TocTree from '@/components/TocTree.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const books = useBooksStore()
const settingsStore = useSettingsStore()
const stats = useStatsStore()

const host = ref<HTMLElement | null>(null)
const book = ref<BookRecord | null>(null)
const engine = ref<ReaderEngine | null>(null)
const percent = ref(0)
const chromeVisible = ref(true)
const panel = ref<'none' | 'toc' | 'annot' | 'settings' | 'search' | 'tts' | 'more'>('none')
const toc = ref<TocItem[]>([])
const annots = ref<AnnotationRecord[]>([])
const searchQuery = ref('')
const searchHits = ref<SearchHit[]>([])
const searchBusy = ref(false)
const searchFeedback = ref<'idle' | 'need-query' | 'done'>('idle')
const searchInputRef = ref<HTMLInputElement | null>(null)
const selectionBar = ref<{
  left: number
  top: number
  text: string
  locator: Locator
} | null>(null)
const noteDraft = ref('')
const dictResult = ref<string | null>(null)
const error = ref('')
const statusMsg = ref('')
const ttsSpeaking = ref(false)
const ttsVoices = ref<SpeechSynthesisVoice[]>([])
const isFinePointer = ref(false)
const stageRef = ref<HTMLElement | null>(null)
const tts = createTts()
let progressTimer: number | null = null
let hideChromeTimer: number | null = null
let statusTimer: number | null = null
let wheelLockUntil = 0
/** Swallow chrome/page-turn click that follows a drag-select */
let ignoreTapUntil = 0
let unsubTtsVoices: (() => void) | null = null

function refreshTtsVoices() {
  ttsVoices.value = tts.listVoicesSorted()
  const id = settingsStore.settings.ttsVoiceURI
  if (!id) return
  if (ttsVoices.value.some((v) => voiceIdOf(v) === id)) return
  // Migrate legacy ids, or reset if the voice is gone
  const found = pickVoice(id)
  void settingsStore.update({ ttsVoiceURI: found ? voiceIdOf(found) : '' })
}

function voiceOptionLabel(v: SpeechSynthesisVoice) {
  const neural = /neural|natural|online|premium|enhanced|wavenet|studio/i.test(v.name)
  const tag = neural ? ' ★' : v.localService ? ' · 本地' : ''
  return `${v.name} · ${v.lang}${tag}`
}

const settings = computed(() => settingsStore.settings)
const desktopUi = computed(() => isFinePointer.value || detectDevice() === 'desktop')
const themeMode = computed(() => effectiveTheme(settings.value))
const pageRef = ref<HTMLElement | null>(null)
const ttsVoiceLabel = computed(() => {
  const id = settings.value.ttsVoiceURI
  if (!id) return '自动（优选中文神经语音）'
  const hit = ttsVoices.value.find((v) => voiceIdOf(v) === id)
  return hit ? `${hit.name} (${hit.lang})` : '自动（优选中文神经语音）'
})

function ttsSpeakOpts() {
  return {
    rate: settings.value.ttsRate,
    pitch: settings.value.ttsPitch,
    voiceURI: settings.value.ttsVoiceURI || undefined,
  }
}

async function onTtsVoiceChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  // Keep speak inside the same user-gesture turn; persist setting without blocking preview
  void settingsStore.update({ ttsVoiceURI: value })
  settingsStore.settings.ttsVoiceURI = value
  const sample =
    selectionBar.value?.text?.trim().slice(0, 40) || '你好，这是当前朗读音色的试听。'
  ttsSpeaking.value = true
  flashStatus('试听新音色…')
  tts.speak(sample, {
    rate: settings.value.ttsRate,
    pitch: settings.value.ttsPitch,
    voiceURI: value || undefined,
  }, () => {
    ttsSpeaking.value = false
    flashStatus('试听结束')
  })
}

function syncPageTheme() {
  const el = pageRef.value
  if (!el) return
  const vars = THEME_VARS[themeMode.value]
  Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v))
}

watch(themeMode, () => syncPageTheme())

const pageTurnHint: Record<string, string> = {
  slide: '整页切换，滚轮/点按翻页更干脆',
  scroll: '连续滚动阅读，滚轮自由滑动',
  curl: '仿真翻页：模拟纸书，下一页从右向左翻，上一页从左向右翻',
}

function flashStatus(msg: string) {
  statusMsg.value = msg
  if (statusTimer) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    statusMsg.value = ''
  }, 2200)
}

watch(
  () => settingsStore.settings.pageTurn,
  (mode, prev) => {
    if (prev && mode !== prev) {
      flashStatus(
        mode === 'scroll' ? '已切换：滚动模式' : mode === 'curl' ? '已切换：仿真翻页' : '已切换：平移翻页',
      )
    }
  },
)

watch(
  () => settingsStore.settings,
  () => {
    engine.value?.applySettings(settings.value)
    syncPageTheme()
  },
  { deep: true },
)

function hasTextSelection() {
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && sel.toString().trim()) return true
  return Boolean(engine.value?.captureSelection?.()?.text)
}

function shouldBlockTapActions() {
  if (Date.now() < ignoreTapUntil) return true
  if (selectionBar.value) return true
  return hasTextSelection()
}

const annotUiActive = computed(() => Boolean(selectionBar.value))

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
  // Drag-select ends with a click; ignore chrome/page-turn for a short window.
  ignoreTapUntil = Date.now() + 450
}

function clearSelectionBar() {
  selectionBar.value = null
  noteDraft.value = ''
  // Defer clearing selection so toolbar click handlers finish first
  window.setTimeout(() => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      /* */
    }
  }, 0)
}

function turnByDelta(deltaY: number) {
  if (!engine.value || panel.value !== 'none') return
  if (shouldBlockTapActions()) return
  if (settings.value.pageTurn === 'scroll' && book.value?.format !== 'epub') return
  const now = Date.now()
  if (now < wheelLockUntil) return
  if (Math.abs(deltaY) < 8) return
  wheelLockUntil = now + 220
  if (deltaY > 0) void engine.value.next()
  else void engine.value.prev()
}

function onStageWheel(e: WheelEvent) {
  if (settings.value.pageTurn === 'scroll') return
  const target = e.target as HTMLElement | null
  // TXT/PDF manage their own wheel (scroll inside chapter, flip at edges).
  if (target?.closest?.('.txt-content, .pdf-pages, .pdf-page')) return
  e.preventDefault()
  turnByDelta(e.deltaY)
}

function onEngineWheel(deltaY: number) {
  turnByDelta(deltaY)
}

function onEdgeTurn(dir: 'prev' | 'next') {
  if (shouldBlockTapActions()) return
  if (dir === 'prev') void engine.value?.prev()
  else void engine.value?.next()
}

function onStageClick(e: MouseEvent) {
  if (panel.value !== 'none') return
  if (Date.now() < ignoreTapUntil) return
  // Blank tap dismisses annotate bar (no chrome toggle / page turn).
  if (selectionBar.value) {
    clearSelectionBar()
    return
  }
  if (hasTextSelection()) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  // Center band toggles chrome; outer bands turn pages (backup if edge-zone missed).
  if (x < 0.22) {
    onEdgeTurn('prev')
    return
  }
  if (x > 0.78) {
    onEdgeTurn('next')
    return
  }
  toggleChrome()
}

function onContentTap(ev: ContentTapEvent) {
  if (panel.value !== 'none') {
    closePanel()
    return
  }
  if (ev.isLink) return
  if (ev.hasSelection || Date.now() < ignoreTapUntil) return
  if (selectionBar.value) {
    clearSelectionBar()
    return
  }
  if (hasTextSelection()) return
  const stage = stageRef.value
  if (!stage) {
    toggleChrome()
    return
  }
  const rect = stage.getBoundingClientRect()
  // Map iframe-local coords roughly: EPUB iframe fills stage.
  const x = (ev.clientX - rect.left) / Math.max(1, rect.width)
  if (x > 0 && x < 1) {
    if (x < 0.22) {
      onEdgeTurn('prev')
      return
    }
    if (x > 0.78) {
      onEdgeTurn('next')
      return
    }
  }
  toggleChrome()
}

function onEngineSelection(ev: SelectionCaptureEvent | null) {
  if (!ev?.text) return
  openSelectionBarFromEvent(ev)
}

function onPointerUp() {
  // Engines emit onSelection; stage pointerup is a TXT/PDF fallback only.
  window.setTimeout(() => {
    if (selectionBar.value) return
    const cap = engine.value?.captureSelection?.()
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
  try {
    await navigator.clipboard.writeText(text)
    flashStatus('已复制')
  } catch {
    flashStatus('复制失败')
  }
}

function onProgressSeek(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  const pct = ratio * 100
  percent.value = pct
  void engine.value?.goToPercent?.(pct)
}

function onProgressKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  // jump forward 5% as a keyboard affordance
  const pct = Math.min(100, percent.value + 5)
  percent.value = pct
  void engine.value?.goToPercent?.(pct)
}

async function init() {
  error.value = ''
  try {
    await books.refresh()
    await settingsStore.load()
    const b = books.books.find((x) => x.id === props.id) || null
    book.value = b
    if (!b) {
      error.value = '未找到书籍'
      return
    }
    const blob = await books.getBlob(b.id)
    if (!blob) {
      error.value = b.storage === 'fs' ? '无法读取书库文件，请重新关联文件夹' : '书籍文件缺失'
      return
    }

    let eng: ReaderEngine
    if (b.format === 'txt') eng = new TxtEngine()
    else if (b.format === 'epub') eng = new EpubEngine()
    else eng = new PdfEngine()

    await nextTick()
    if (!host.value) {
      error.value = '阅读器容器未就绪，请刷新重试'
      return
    }
    await eng.open(blob, settings.value, host.value)
    eng.onProgress?.((p) => {
      percent.value = p.percent
      scheduleSave(p.locator, p.percent)
    })
    eng.onWheel?.(onEngineWheel)
    eng.onContentTap?.(onContentTap)
    eng.onSelection?.(onEngineSelection)
    engine.value = eng
    toc.value = eng.getToc()
    annots.value = await books.listAnnotations(b.id)

    const saved = await books.getProgress(b.id)
    if (saved?.locator) await eng.goTo(saved.locator)
    eng.applyAnnotations?.(annots.value)
    stats.startSession(b.id)
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? `打开失败：${err.message}` : '打开书籍失败'
    engine.value?.destroy()
    engine.value = null
  }
}

function scheduleSave(locator: Locator, pct: number) {
  if (progressTimer) window.clearTimeout(progressTimer)
  progressTimer = window.setTimeout(() => {
    if (book.value) void books.saveProgress(book.value.id, locator, pct)
  }, 800)
}

function flushProgress() {
  if (!engine.value || !book.value) return
  const p = engine.value.getProgress()
  void books.saveProgress(book.value.id, p.locator, p.percent)
}

function toggleChrome() {
  chromeVisible.value = !chromeVisible.value
}

function closePanel() {
  panel.value = 'none'
}

function openPanel(p: typeof panel.value) {
  panel.value = panel.value === p ? 'none' : p
  chromeVisible.value = true
  if (panel.value !== 'none') clearSelectionBar()
  if (panel.value === 'search') {
    searchFeedback.value = 'idle'
    void nextTick(() => searchInputRef.value?.focus())
  }
}

async function runSearch() {
  const q = searchQuery.value.trim()
  if (!q) {
    searchHits.value = []
    searchFeedback.value = 'need-query'
    engine.value?.highlightSearch?.(null)
    return
  }
  searchBusy.value = true
  searchFeedback.value = 'idle'
  try {
    searchHits.value = (await engine.value?.search?.(q)) || []
    searchFeedback.value = 'done'
    // Preview highlight on current page while browsing results
    if (searchHits.value.length) engine.value?.highlightSearch?.(q)
    else engine.value?.highlightSearch?.(null)
  } catch (err) {
    console.error(err)
    searchHits.value = []
    searchFeedback.value = 'done'
    engine.value?.highlightSearch?.(null)
    flashStatus('搜索失败')
  } finally {
    searchBusy.value = false
  }
}

function clearSearch() {
  searchQuery.value = ''
  searchHits.value = []
  searchFeedback.value = 'idle'
  engine.value?.highlightSearch?.(null)
  void nextTick(() => searchInputRef.value?.focus())
}

async function goToc(item: TocItem) {
  await engine.value?.goTo(item.locator)
  panel.value = 'none'
}

async function goHit(hit: SearchHit) {
  const q = searchQuery.value.trim()
  await engine.value?.goTo(hit.locator)
  // Ensure highlight after navigation (engines also re-apply on goTo)
  engine.value?.highlightSearch?.(q || null)
  panel.value = 'none'
  if (q) flashStatus(`已定位：${q}`)
}

function snippetHtml(snippet: string) {
  return markQueryInSnippet(snippet, searchQuery.value)
}

async function goAnnot(a: AnnotationRecord) {
  await engine.value?.goTo(a.locator)
  panel.value = 'none'
}

async function addHighlight(color: string) {
  if (!selectionBar.value || !book.value) return
  const bar = selectionBar.value
  // Prefer live capture so EPUB CFI is still available before selection clears
  const live = engine.value?.captureSelection?.()
  let locator = bar.locator
  if (live?.text && live.locator) {
    if (live.locator.type === 'epub' && live.locator.cfi) locator = live.locator
    else if (live.locator.type !== 'epub') locator = live.locator
  }
  if (locator.type === 'epub' && !locator.cfi) {
    flashStatus('无法定位笔记位置，请重新拖选后再试')
    return
  }
  const annot: AnnotationRecord = {
    id: uid('ann'),
    bookId: book.value.id,
    type: 'highlight',
    color,
    selectedText: bar.text,
    note: noteDraft.value || undefined,
    locator,
    createdAt: Date.now(),
  }
  try {
    await books.addAnnotation(annot)
    annots.value = await books.listAnnotations(book.value.id)
    engine.value?.applyAnnotations?.(annots.value)
    clearSelectionBar()
    flashStatus('已保存笔记')
  } catch (err) {
    console.error(err)
    flashStatus('笔记保存失败')
  }
}

async function addBookmark() {
  if (!book.value || !engine.value) return
  const p = engine.value.getProgress()
  const annot: AnnotationRecord = {
    id: uid('ann'),
    bookId: book.value.id,
    type: 'bookmark',
    color: '#c4a574',
    locator: p.locator,
    createdAt: Date.now(),
  }
  await books.addAnnotation(annot)
  annots.value = await books.listAnnotations(book.value.id)
  engine.value.applyAnnotations?.(annots.value)
}

async function removeAnnot(id: string) {
  await books.removeAnnotation(id)
  if (book.value) {
    annots.value = await books.listAnnotations(book.value.id)
    engine.value?.applyAnnotations?.(annots.value)
  }
}

function exportAnnots(kind: 'md' | 'json') {
  if (!book.value) return
  if (kind === 'md') {
    downloadText(`${book.value.title}-annotations.md`, annotationsToMarkdown(book.value, annots.value), 'text/markdown')
  } else {
    downloadText(`${book.value.title}-annotations.json`, annotationsToJson(book.value, annots.value), 'application/json')
  }
}

function speakSelection() {
  const text = selectionBar.value?.text || engine.value?.getSelectableText?.() || ''
  if (!text.trim()) {
    flashStatus('没有可朗读的内容，请先选中文字或打开有正文的页面')
    return
  }
  ttsSpeaking.value = true
  flashStatus('正在朗读…')
  tts.speak(text, ttsSpeakOpts(), () => {
    ttsSpeaking.value = false
    flashStatus('朗读结束')
  })
}

function toggleTtsPlay() {
  if (tts.isSpeaking() || ttsSpeaking.value) {
    stopReadingAloud()
    return
  }
  // Page read: clear selection bar so getSelectableText is used
  selectionBar.value = null
  speakSelection()
}

let ttsLongPressTimer: number | null = null
let ttsLongPressFired = false

function onTtsPlayPointerDown() {
  ttsLongPressFired = false
  if (ttsLongPressTimer) window.clearTimeout(ttsLongPressTimer)
  ttsLongPressTimer = window.setTimeout(() => {
    ttsLongPressTimer = null
    ttsLongPressFired = true
    openPanel('tts')
  }, 450)
}

function onTtsPlayPointerUp() {
  if (ttsLongPressTimer) {
    window.clearTimeout(ttsLongPressTimer)
    ttsLongPressTimer = null
  }
}

function onTtsPlayPointerCancel() {
  if (ttsLongPressTimer) {
    window.clearTimeout(ttsLongPressTimer)
    ttsLongPressTimer = null
  }
}

function onTtsPlayClick(e: Event) {
  if (ttsLongPressFired) {
    e.preventDefault()
    ttsLongPressFired = false
    return
  }
  toggleTtsPlay()
}

function stopReadingAloud() {
  const wasSpeaking = tts.isSpeaking() || ttsSpeaking.value
  const wasScrolling = settings.value.autoScrollSpeed > 0
  tts.stop()
  ttsSpeaking.value = false
  if (wasScrolling) {
    void settingsStore.update({ autoScrollSpeed: 0 })
  }
  if (wasSpeaking || wasScrolling) {
    flashStatus(wasSpeaking && wasScrolling ? '已停止朗读并关闭自动滚屏' : wasSpeaking ? '已停止朗读' : '已关闭自动滚屏')
  } else {
    flashStatus('当前没有在朗读')
  }
}

async function lookupWord() {
  const word = selectionBar.value?.text?.trim() || ''
  if (!word) return
  const res = await getDictionaryProvider().lookup(word.slice(0, 32))
  dictResult.value = res ? `${res.word}：${res.meanings.join('；')}` : '未找到释义'
  clearSelectionBar()
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault()
    void engine.value?.next()
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault()
    void engine.value?.prev()
  } else if (e.key === 'Home') {
    e.preventDefault()
    void engine.value?.goToPercent?.(0)
  } else if (e.key === 'End') {
    e.preventDefault()
    void engine.value?.goToPercent?.(100)
  } else if (e.key === 't' || e.key === 'T') openPanel('toc')
  else if (e.key === 'b' || e.key === 'B') void addBookmark()
  else if (e.key === 'f' || e.key === 'F') {
    const el = document.documentElement
    if (!document.fullscreenElement) void el.requestFullscreen?.()
    else void document.exitFullscreen?.()
  } else if (e.key === '/') {
    e.preventDefault()
    openPanel('search')
  } else if (e.key === 'Escape') {
    if (panel.value !== 'none') closePanel()
    else if (dictResult.value) dictResult.value = null
    else if (document.fullscreenElement) void document.exitFullscreen?.()
  }
}

function refreshPointerMode() {
  isFinePointer.value = window.matchMedia('(pointer: fine)').matches
}

onMounted(async () => {
  refreshPointerMode()
  window.addEventListener('resize', refreshPointerMode)
  refreshTtsVoices()
  unsubTtsVoices = tts.onVoicesChanged(refreshTtsVoices)
  await nextTick()
  syncPageTheme()
  await init()
  syncPageTheme()
  window.addEventListener('keydown', onKey)
  // non-passive so preventDefault works for paginated wheel turning
  stageRef.value?.addEventListener('wheel', onStageWheel, { passive: false })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', refreshPointerMode)
  stageRef.value?.removeEventListener('wheel', onStageWheel)
  unsubTtsVoices?.()
  unsubTtsVoices = null
  flushProgress()
  void stats.endSession()
  tts.stop()
  engine.value?.destroy()
  if (progressTimer) window.clearTimeout(progressTimer)
  if (hideChromeTimer) window.clearTimeout(hideChromeTimer)
  if (statusTimer) window.clearTimeout(statusTimer)
  if (ttsLongPressTimer) window.clearTimeout(ttsLongPressTimer)
})

function clearUiSelection() {
  window.getSelection()?.removeAllRanges()
}

function back() {
  clearUiSelection()
  flushProgress()
  void stats.endSession()
  void router.push({ name: 'shelf' })
}

async function confirmDeleteBook() {
  if (!book.value) return
  const ok = await confirmDialog({
    title: '删除本书',
    message: `确定删除「${book.value.title}」？\n将返回书架，阅读进度与笔记也会删除。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await books.remove(book.value.id)
  back()
}
</script>

<template>
  <div
    ref="pageRef"
    class="reader-page"
    :class="{ desktop: desktopUi, 'annot-active': annotUiActive, 'panel-open': panel !== 'none' }"
    :data-turn="settings.pageTurn"
    :data-theme="themeMode"
  >
    <header v-show="chromeVisible" class="reader-chrome" @mousedown="clearUiSelection">
      <button class="btn ghost" @click="back">返回</button>
      <button
        type="button"
        class="chrome-title"
        :title="book?.title || '阅读'"
        @mousedown.prevent
        @click="openPanel('toc')"
      >
        {{ book?.title || '阅读' }}
      </button>
      <div class="chrome-actions">
        <button class="btn ghost" @click="openPanel('toc')">目录</button>
        <button class="btn ghost" @click="openPanel('search')">搜索</button>
        <button class="btn ghost" title="排版" @click="openPanel('settings')">Aa</button>
        <button class="btn ghost" title="更多" @click="openPanel('more')">⋯</button>
      </div>
    </header>

    <div v-if="error" class="warn">{{ error }}</div>
    <div v-if="statusMsg" class="warn status-toast">{{ statusMsg }}</div>

    <div
      ref="stageRef"
      class="reader-stage"
      @pointerup="onPointerUp"
      @click="onStageClick"
    >
      <div ref="host" class="engine-host" />
      <div
        class="edge-zone left"
        title="上一页"
        @click.stop="onEdgeTurn('prev')"
      />
      <div
        class="edge-zone right"
        title="下一页"
        @click.stop="onEdgeTurn('next')"
      />
    </div>

    <div
      v-if="dictResult"
      class="dict-popup"
      role="status"
      @click.stop
      @pointerdown.stop
    >
      <div class="dict-popup-body">{{ dictResult }}</div>
      <button type="button" class="dict-popup-close" title="关闭释义" @click="dictResult = null">
        关闭
      </button>
    </div>

    <!-- Fixed annotate toolbar: outside overflow:hidden stage -->
    <div
      v-if="selectionBar"
      class="selection-bar"
      :style="{ left: selectionBar.left + 'px', top: selectionBar.top + 'px' }"
      @click.stop
      @pointerdown.stop
    >
      <button
        v-for="c in HIGHLIGHT_COLORS"
        :key="c"
        type="button"
        class="color-dot"
        :style="{ background: c }"
        title="保存笔记"
        @click.stop.prevent="addHighlight(c)"
      />
      <button type="button" class="btn ghost sel-action" @click.stop="copySelection">复制</button>
      <button type="button" class="btn ghost sel-action" @click.stop="speakSelection">读选中</button>
      <button type="button" class="btn ghost sel-action" @click.stop="lookupWord">释义</button>
      <button type="button" class="btn ghost sel-action" @click.stop="clearSelectionBar">×</button>
    </div>

    <footer v-show="chromeVisible" class="reader-chrome bottom" @mousedown="clearUiSelection">
      <button class="btn ghost" @click="engine?.prev()">上一页</button>
      <div class="chrome-progress">
        <div
          class="progress-bar seekable"
          role="slider"
          tabindex="0"
          :aria-valuenow="Math.round(percent)"
          aria-valuemin="0"
          aria-valuemax="100"
          title="点击跳转进度"
          @click.stop="onProgressSeek"
          @keydown="onProgressKey"
        >
          <span :style="{ width: formatPercent(percent) }" />
        </div>
        <span class="chrome-percent">{{ formatPercent(percent) }}</span>
      </div>
      <button class="btn ghost" title="添加书签" @click="addBookmark">书签</button>
      <button class="btn ghost" title="笔记与书签列表" @click="openPanel('annot')">笔记</button>
      <div class="tts-dock">
        <button
          type="button"
          class="btn ghost tts-play"
          :class="{ active: ttsSpeaking }"
          :title="ttsSpeaking ? '停止朗读' : '朗读本页（长按打开设置）'"
          @pointerdown="onTtsPlayPointerDown"
          @pointerup="onTtsPlayPointerUp"
          @pointerleave="onTtsPlayPointerCancel"
          @pointercancel="onTtsPlayPointerCancel"
          @click="onTtsPlayClick"
        >
          {{ ttsSpeaking ? '■ 停' : '▶ 听' }}
        </button>
        <button
          type="button"
          class="btn ghost tts-menu"
          title="朗读设置"
          @click="openPanel('tts')"
        >
          ▾
        </button>
      </div>
      <button class="btn ghost" @click="engine?.next()">下一页</button>
    </footer>

    <div
      v-if="panel !== 'none'"
      class="reader-backdrop"
      aria-hidden="true"
      @click="closePanel"
      @wheel.prevent
    />

    <aside class="panel" :class="{ open: panel === 'toc' }">
      <div class="panel-header">
        <strong>目录</strong>
        <button class="btn ghost" @click="closePanel">关闭</button>
      </div>
      <div class="panel-body toc-panel-body">
        <TocTree v-if="toc.length" :items="toc" @select="goToc" />
        <p v-else style="color: var(--muted)">本书暂无目录。</p>
      </div>
    </aside>

    <aside class="panel" :class="{ open: panel === 'search' }">
      <div class="panel-header">
        <strong>搜索</strong>
        <button class="btn ghost" @click="closePanel">关闭</button>
      </div>
      <div class="panel-body">
        <div class="field">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            placeholder="输入关键词"
            @keydown.enter="runSearch"
          />
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
          <button class="btn primary" :disabled="searchBusy" @click="runSearch">
            {{ searchBusy ? '搜索中…' : '搜索' }}
          </button>
          <button
            class="btn ghost"
            :disabled="searchBusy || (!searchQuery && !searchHits.length && searchFeedback === 'idle')"
            @click="clearSearch"
          >
            清空
          </button>
        </div>
        <p v-if="searchBusy" style="color: var(--muted); margin-top: 0.75rem">正在搜索全书…</p>
        <p v-else-if="searchFeedback === 'need-query'" style="color: var(--muted); margin-top: 0.75rem">
          请输入关键词
        </p>
        <p
          v-else-if="searchFeedback === 'done' && !searchHits.length"
          style="color: var(--muted); margin-top: 0.75rem"
        >
          未找到「{{ searchQuery.trim() }}」
        </p>
        <p
          v-else-if="searchFeedback === 'done' && searchHits.length"
          style="color: var(--muted); margin-top: 0.75rem; font-size: 0.85rem"
        >
          找到 {{ searchHits.length }} 处，点击跳转
        </p>
        <div
          v-for="(h, i) in searchHits"
          :key="i"
          class="panel-item"
          @click="goHit(h)"
          v-html="snippetHtml(h.snippet)"
        />
      </div>
    </aside>

    <aside class="panel" :class="{ open: panel === 'annot' }">
      <div class="panel-header">
        <strong>笔记</strong>
        <button class="btn ghost" @click="closePanel">关闭</button>
      </div>
      <div class="panel-body">
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem">
          <button class="btn" @click="exportAnnots('md')">导出 MD</button>
          <button class="btn" @click="exportAnnots('json')">导出 JSON</button>
        </div>
        <div v-for="a in annots" :key="a.id" class="panel-item">
          <div @click="goAnnot(a)">
            <small>{{ a.type === 'bookmark' ? '书签' : '高亮' }} · {{ new Date(a.createdAt).toLocaleString() }}</small>
            <div>{{ a.selectedText || '书签位置' }}</div>
            <div v-if="a.note" style="color: var(--muted)">{{ a.note }}</div>
          </div>
          <button class="btn danger" style="margin-top: 0.35rem" @click="removeAnnot(a.id)">删除</button>
        </div>
        <p v-if="!annots.length" style="color: var(--muted)">
          暂无笔记。拖选正文点颜色可保存高亮；底栏「书签」记下位置，「笔记」查看列表。
        </p>
      </div>
    </aside>

    <aside class="panel" :class="{ open: panel === 'settings' }">
      <div class="panel-header">
        <strong>排版</strong>
        <button class="btn ghost" @click="closePanel">关闭</button>
      </div>
      <div class="panel-body">
        <div class="field">
          <label>字号 {{ settings.fontSize }}</label>
          <input
            type="range"
            min="14"
            max="36"
            :value="settings.fontSize"
            @input="settingsStore.update({ fontSize: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>行距 {{ settings.lineHeight }}</label>
          <input
            type="range"
            min="1.2"
            max="2.4"
            step="0.05"
            :value="settings.lineHeight"
            @input="settingsStore.update({ lineHeight: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>段距 {{ settings.paragraphGap }}</label>
          <input
            type="range"
            min="0.2"
            max="2"
            step="0.1"
            :value="settings.paragraphGap"
            @input="settingsStore.update({ paragraphGap: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>左右边距 {{ settings.marginX }}</label>
          <input
            type="range"
            min="8"
            max="64"
            :value="settings.marginX"
            @input="settingsStore.update({ marginX: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>上下边距 {{ settings.marginY }}</label>
          <input
            type="range"
            min="4"
            max="48"
            :value="settings.marginY"
            @input="settingsStore.update({ marginY: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>首行缩进 {{ settings.indent }}</label>
          <input
            type="range"
            min="0"
            max="4"
            step="0.5"
            :value="settings.indent"
            @input="settingsStore.update({ indent: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>主题</label>
          <div class="seg-group" role="radiogroup" aria-label="主题">
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.theme === 'light' }"
              @click="settingsStore.update({ theme: 'light' })"
            >
              浅色
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.theme === 'dark' }"
              @click="settingsStore.update({ theme: 'dark' })"
            >
              深色
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.theme === 'sepia' }"
              @click="settingsStore.update({ theme: 'sepia' })"
            >
              羊皮纸
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.theme === 'green' }"
              @click="settingsStore.update({ theme: 'green' })"
            >
              护眼绿
            </button>
          </div>
        </div>
        <div class="field">
          <label>翻页模式</label>
          <div class="seg-group" role="radiogroup" aria-label="翻页模式">
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.pageTurn === 'slide' }"
              @click="settingsStore.update({ pageTurn: 'slide' })"
            >
              平移
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.pageTurn === 'scroll' }"
              @click="settingsStore.update({ pageTurn: 'scroll' })"
            >
              滚动
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: settings.pageTurn === 'curl' }"
              @click="settingsStore.update({ pageTurn: 'curl' })"
            >
              仿真
            </button>
          </div>
          <p class="seg-hint">{{ pageTurnHint[settings.pageTurn] }}</p>
        </div>
        <div class="field">
          <label>亮度 {{ settings.brightness }}</label>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            :value="settings.brightness"
            @input="settingsStore.update({ brightness: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>自动滚屏速度 {{ settings.autoScrollSpeed }}（0 关闭）</label>
          <input
            type="range"
            min="0"
            max="8"
            step="1"
            :value="settings.autoScrollSpeed"
            @input="settingsStore.update({ autoScrollSpeed: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>
            <input
              type="checkbox"
              :checked="settings.dualColumn"
              @change="settingsStore.update({ dualColumn: ($event.target as HTMLInputElement).checked })"
            />
            宽屏双栏
          </label>
        </div>
        <div class="field">
          <label>
            <input
              type="checkbox"
              :checked="settings.autoDark"
              @change="settingsStore.update({ autoDark: ($event.target as HTMLInputElement).checked })"
            />
            按时段自动深色
          </label>
        </div>
        <div class="field">
          <label>正文字体</label>
          <div class="seg-group" role="radiogroup" aria-label="正文字体">
            <button
              v-for="f in FONT_PRESETS"
              :key="f.id"
              type="button"
              class="seg-btn"
              :class="{ active: settings.fontFamily === f.value }"
              :style="{ fontFamily: f.value }"
              @click="settingsStore.update({ fontFamily: f.value })"
            >
              {{ f.label }}
            </button>
          </div>
        </div>
      </div>
    </aside>

    <aside class="panel" :class="{ open: panel === 'tts' }">
      <div class="panel-header">
        <strong>朗读</strong>
        <button class="btn ghost" @click="closePanel">关闭</button>
      </div>
      <div class="panel-body">
        <p style="color: var(--muted); font-size: 0.85rem; margin-top: 0">
          点底栏「▶ 听」朗读本页；「▾」或长按打开本页设置。选中文字后可用「读选中」。
        </p>
        <div class="field">
          <label>音色</label>
          <select
            :value="settings.ttsVoiceURI"
            @change="onTtsVoiceChange"
          >
            <option value="">自动（优选中文神经语音）</option>
            <option v-for="v in ttsVoices" :key="voiceIdOf(v)" :value="voiceIdOf(v)">
              {{ voiceOptionLabel(v) }}
            </option>
          </select>
          <p class="field-hint">
            当前：{{ ttsVoiceLabel }}。列表仅显示中文音色；切换后会试听。若仍无声，请改选带「本地」感的音色，或先选「自动」。
          </p>
        </div>
        <div class="field">
          <label>语速 {{ settings.ttsRate }}</label>
          <input
            type="range"
            min="0.6"
            max="1.6"
            step="0.1"
            :value="settings.ttsRate"
            @input="settingsStore.update({ ttsRate: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field">
          <label>音高 {{ settings.ttsPitch }}</label>
          <input
            type="range"
            min="0.7"
            max="1.4"
            step="0.05"
            :value="settings.ttsPitch"
            @input="settingsStore.update({ ttsPitch: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <button
          v-if="!ttsSpeaking"
          class="btn primary"
          style="margin-top: 0.25rem; display: block; width: 100%"
          @click="speakSelection"
        >
          朗读本页
        </button>
        <button
          v-else
          class="btn"
          style="margin-top: 0.25rem; display: block; width: 100%"
          @click="stopReadingAloud"
        >
          停止朗读
        </button>
      </div>
    </aside>

    <aside class="panel" :class="{ open: panel === 'more' }">
      <div class="panel-header">
        <strong>更多</strong>
        <button class="btn ghost" @click="closePanel">关闭</button>
      </div>
      <div class="panel-body">
        <p>格式：{{ book?.format }} · 存储：{{ book?.storage }}</p>
        <p v-if="book?.fsPath">路径：{{ book.fsPath }}</p>
        <p>阅读统计：累计 {{ Math.round(stats.stats.totalMinutes) }} 分钟</p>
        <p style="color: var(--muted); font-size: 0.85rem">
          快捷键：←/→/空格/PgUp/PgDn 翻页 · Home/End 首尾 · T 目录 · B 书签 · F 全屏 · / 搜索
          <br />
          顶栏 Aa 排版 · ⋯ 更多；底栏 ▶ 听书、▾ 朗读设置；选区可「读选中」。
          <br />
          笔记：拖选文字后点颜色保存；点空白可显隐菜单。
          <template v-if="desktopUi"> · 滚轮翻页 · 点进度条跳转</template>
        </p>
        <button
          class="btn danger"
          style="margin-top: 0.75rem; display: block; width: 100%"
          @click="confirmDeleteBook"
        >
          删除本书
        </button>
      </div>
    </aside>
  </div>
</template>
