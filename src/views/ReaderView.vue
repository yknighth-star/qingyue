<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBooksStore } from '@/stores/books'
import { useSettingsStore } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import { confirmDialog } from '@/composables/useConfirm'
import { useReaderChrome } from '@/composables/useReaderChrome'
import { useReaderGestures } from '@/composables/useReaderGestures'
import { useReaderSearch } from '@/composables/useReaderSearch'
import { useReaderSession } from '@/composables/useReaderSession'
import { useReaderTts } from '@/composables/useReaderTts'
import { useSelectionAnnot } from '@/composables/useSelectionAnnot'
import { detectDevice, effectiveTheme, formatPercent, THEME_VARS } from '@/utils/format'
import type { ContentTapEvent, SelectionCaptureEvent } from '@/engines/types'
import type { TocItem } from '@/types'
import ReaderTocPanel from '@/components/reader/ReaderTocPanel.vue'
import ReaderSearchPanel from '@/components/reader/ReaderSearchPanel.vue'
import ReaderAnnotPanel from '@/components/reader/ReaderAnnotPanel.vue'
import ReaderSettingsPanel from '@/components/reader/ReaderSettingsPanel.vue'
import ReaderTtsPanel from '@/components/reader/ReaderTtsPanel.vue'
import ReaderMorePanel from '@/components/reader/ReaderMorePanel.vue'
import ReaderSelectionBar from '@/components/reader/ReaderSelectionBar.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const books = useBooksStore()
const settingsStore = useSettingsStore()
const statsStore = useStatsStore()

const host = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const pageRef = ref<HTMLElement | null>(null)
const isFinePointer = ref(false)
const statusMsg = ref('')
let statusTimer: number | null = null

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

const settings = computed(() => settingsStore.settings)
const desktopUi = computed(() => isFinePointer.value || detectDevice() === 'desktop')
const themeMode = computed(() => effectiveTheme(settings.value))

const {
  chromeVisible,
  panel,
  toggleChrome,
  closePanel,
  openPanel,
} = useReaderChrome({
  onPanelOpen: (p) => {
    if (p !== 'none') clearSelectionBar()
    if (p === 'search') searchFeedback.value = 'idle'
  },
})

const wheelHandler = { fn: (_deltaY: number) => {} }
const tapHandler = { fn: (_ev: ContentTapEvent) => {} }
const selectionHandler = { fn: (_ev: SelectionCaptureEvent | null) => {} }

const {
  book,
  engine,
  percent,
  toc,
  opening,
  openHint,
  error,
  open: openSession,
  destroy: destroySession,
  flushProgress,
  applySettings,
} = useReaderSession({
  bookId: props.id,
  host,
  onWheel: (d) => wheelHandler.fn(d),
  onContentTap: (ev) => tapHandler.fn(ev),
  onSelection: (ev) => selectionHandler.fn(ev),
})

const {
  annots,
  selectionBar,
  dictResult,
  annotUiActive,
  getIgnoreTapUntil,
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
} = useSelectionAnnot({
  book,
  engine,
  flashStatus,
  closePanel,
})

const {
  searchQuery,
  searchHits,
  searchBusy,
  searchFeedback,
  runSearch,
  clearSearch,
  goHit,
  snippetHtml,
} = useReaderSearch({
  engine,
  flashStatus,
  closePanel,
})

const {
  ttsSpeaking,
  ttsVoices,
  ttsVoiceLabel,
  voiceIdOf,
  voiceOptionLabel,
  mountVoices,
  unmountVoices,
  onTtsVoiceChange,
  speakSelection,
  stopReadingAloud,
  onTtsPlayPointerDown,
  onTtsPlayPointerUp,
  onTtsPlayPointerCancel,
  onTtsPlayClick,
} = useReaderTts({
  flashStatus,
  getSpeakText,
  clearSelectionBar: () => {
    selectionBar.value = null
  },
  openTtsPanel: () => openPanel('tts'),
})

const {
  onStageWheel,
  onEngineWheel,
  onEdgeTurn,
  onStageClick,
  onContentTap,
} = useReaderGestures({
  engine,
  book,
  panel,
  stageRef,
  pageTurn: () => settings.value.pageTurn,
  shouldBlockTapActions,
  hasTextSelection,
  selectionBar,
  getIgnoreTapUntil,
  clearSelectionBar,
  toggleChrome,
  closePanel,
})

wheelHandler.fn = onEngineWheel
tapHandler.fn = onContentTap
selectionHandler.fn = onEngineSelection

function syncPageTheme() {
  const el = pageRef.value
  if (!el) return
  const vars = THEME_VARS[themeMode.value]
  Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v))
}

watch(themeMode, () => syncPageTheme())

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
    applySettings()
    syncPageTheme()
  },
  { deep: true },
)

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
  const pct = Math.min(100, percent.value + 5)
  percent.value = pct
  void engine.value?.goToPercent?.(pct)
}

async function goToc(item: TocItem) {
  await engine.value?.goTo(item.locator)
  closePanel()
}

function onSearchQuery(value: string) {
  searchQuery.value = value
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

function clearUiSelection() {
  window.getSelection()?.removeAllRanges()
}

function back() {
  clearUiSelection()
  flushProgress()
  void statsStore.endSession()
  void router.push({ name: 'shelf' })
}

async function confirmDeleteBook() {
  if (!book.value) return
  const ok = await confirmDialog({
    title: '删除此文件',
    message: `确定删除「${book.value.title}」？\n将返回列表，阅读进度与笔记也会删除。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await books.remove(book.value.id)
  back()
}

async function boot() {
  const result = await openSession()
  if (!result) return
  const { book: b, engine: eng } = result
  await loadAnnotations(b.id)
  const saved = await books.getProgress(b.id)
  if (saved?.locator) await eng.goTo(saved.locator)
  window.setTimeout(() => {
    toc.value = eng.getToc()
  }, 400)
  eng.applyAnnotations?.(annots.value)
}

onMounted(async () => {
  refreshPointerMode()
  window.addEventListener('resize', refreshPointerMode)
  mountVoices()
  await nextTick()
  syncPageTheme()
  await boot()
  syncPageTheme()
  window.addEventListener('keydown', onKey)
  stageRef.value?.addEventListener('wheel', onStageWheel, { passive: false })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', refreshPointerMode)
  stageRef.value?.removeEventListener('wheel', onStageWheel)
  unmountVoices()
  destroySession()
  if (statusTimer) window.clearTimeout(statusTimer)
})
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

    <div v-if="opening" class="open-overlay" role="status" aria-live="polite">
      <div class="open-card">
        <div class="open-spinner" aria-hidden="true" />
        <p class="open-title">{{ book?.title || '轻阅' }}</p>
        <p class="open-hint">{{ openHint }}</p>
      </div>
    </div>

    <div ref="stageRef" class="reader-stage" @pointerup="onPointerUp" @click="onStageClick">
      <div ref="host" class="engine-host" />
      <div class="edge-zone left" title="上一页" @click.stop="onEdgeTurn('prev')" />
      <div class="edge-zone right" title="下一页" @click.stop="onEdgeTurn('next')" />
    </div>

    <div v-if="dictResult" class="dict-popup" role="status" @click.stop @pointerdown.stop>
      <div class="dict-popup-body">{{ dictResult }}</div>
      <button type="button" class="dict-popup-close" title="关闭释义" @click="dictResult = null">
        关闭
      </button>
    </div>

    <ReaderSelectionBar
      v-if="selectionBar"
      :left="selectionBar.left"
      :top="selectionBar.top"
      @highlight="addHighlight"
      @copy="copySelection"
      @speak="speakSelection"
      @lookup="lookupWord"
      @close="clearSelectionBar"
    />

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
        <button type="button" class="btn ghost tts-menu" title="朗读设置" @click="openPanel('tts')">
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

    <ReaderTocPanel :open="panel === 'toc'" :toc="toc" @close="closePanel" @select="goToc" />

    <ReaderSearchPanel
      :open="panel === 'search'"
      :query="searchQuery"
      :hits="searchHits"
      :busy="searchBusy"
      :feedback="searchFeedback"
      :snippet-html="snippetHtml"
      @close="closePanel"
      @update:query="onSearchQuery"
      @search="runSearch"
      @clear="clearSearch"
      @select="goHit"
    />

    <ReaderAnnotPanel
      :open="panel === 'annot'"
      :annots="annots"
      @close="closePanel"
      @select="goAnnot"
      @remove="removeAnnot"
      @export="exportAnnots"
    />

    <ReaderSettingsPanel
      :open="panel === 'settings'"
      :settings="settings"
      :format="book?.format"
      :page-turn-hint="pageTurnHint"
      @close="closePanel"
      @update="settingsStore.update"
    />

    <ReaderTtsPanel
      :open="panel === 'tts'"
      :settings="settings"
      :tts-voices="ttsVoices"
      :tts-voice-label="ttsVoiceLabel"
      :tts-speaking="ttsSpeaking"
      :voice-id-of="voiceIdOf"
      :voice-option-label="voiceOptionLabel"
      @close="closePanel"
      @voice-change="onTtsVoiceChange"
      @update="settingsStore.update"
      @speak="speakSelection"
      @stop="stopReadingAloud"
    />

    <ReaderMorePanel
      :open="panel === 'more'"
      :book="book"
      :total-minutes="statsStore.stats.totalMinutes"
      :desktop-ui="desktopUi"
      @close="closePanel"
      @delete="confirmDeleteBook"
    />
  </div>
</template>
