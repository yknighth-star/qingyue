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
import { detectDevice, effectiveTheme, formatPageLabel, formatPercent, THEME_VARS } from '@/utils/format'
import { resolveTurnProfile } from '@/utils/turnProfile'
import type { ContentGestureEvent, ContentTapEvent, SelectionCaptureEvent } from '@/engines/types'
import type { TocItem } from '@/types'
import { HIGHLIGHT_COLORS } from '@/types'
import ReaderTocPanel from '@/components/reader/ReaderTocPanel.vue'
import ReaderSearchPanel from '@/components/reader/ReaderSearchPanel.vue'
import ReaderAnnotPanel from '@/components/reader/ReaderAnnotPanel.vue'
import ReaderSettingsPanel from '@/components/reader/ReaderSettingsPanel.vue'
import ReaderTtsPanel from '@/components/reader/ReaderTtsPanel.vue'
import ReaderMorePanel from '@/components/reader/ReaderMorePanel.vue'
import ReaderSelectionBar from '@/components/reader/ReaderSelectionBar.vue'
import ReaderMarkHandles from '@/components/reader/ReaderMarkHandles.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const books = useBooksStore()
const settingsStore = useSettingsStore()
const statsStore = useStatsStore()

const host = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const pageRef = ref<HTMLElement | null>(null)
const isFinePointer = ref(false)
const turnProfile = ref(resolveTurnProfile())
const statusMsg = ref('')
let statusTimer: number | null = null
/** Bumps so schedule/system appearance recomputes without settings change */
const themeTick = ref(0)
const viewportWide = ref(typeof window !== 'undefined' ? window.innerWidth >= 1100 : true)
let themeTickTimer: number | null = null
let systemColorMql: MediaQueryList | null = null

const pageTurnHint: Record<string, string> = {
  slide: '横滑：整页平移翻页，拖动时页面跟随手指滑动',
  scroll: '上下滑动：连续纵滑阅读，不整页跳转',
  curl: '仿真：纸页卷曲翻页（手机为轻量卷曲，仍区别于横滑）',
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
/** Phone / tablet coarse: floating overlay chrome (ref apps). Desktop: bar chrome. */
const floatChrome = computed(() => !desktopUi.value)
const themeMode = computed(() => {
  void themeTick.value
  return effectiveTheme(settings.value)
})

function bumpThemeTick() {
  themeTick.value += 1
}

function onSystemColorScheme() {
  if (settingsStore.settings.appearanceMode === 'system') bumpThemeTick()
}

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
const gestureHandler = { fn: (_ev: ContentGestureEvent) => {} }
const selectionHandler = { fn: (_ev: SelectionCaptureEvent | null) => {} }

const {
  book,
  engine,
  percent,
  page,
  pageCount,
  pageMode,
  toc,
  opening,
  openHint,
  error,
  open: openSession,
  destroy: destroySession,
  flushProgress,
  enableProgressSave,
  applySettings,
} = useReaderSession({
  bookId: props.id,
  host,
  onWheel: (d) => wheelHandler.fn(d),
  onContentTap: (ev) => tapHandler.fn(ev),
  onContentGesture: (ev) => gestureHandler.fn(ev),
  onSelection: (ev) => selectionHandler.fn(ev),
})

const pageLabel = computed(() =>
  formatPageLabel({
    percent: percent.value,
    page: page.value,
    pageCount: pageCount.value,
    pageMode: pageMode.value,
  }),
)

const {
  annots,
  markMode,
  markHandles,
  selectionBar,
  dictResult,
  annotUiActive,
  getIgnoreTapUntil,
  clearSelectionBar,
  onMarkBodyDown,
  onMarkBodyMove,
  onMarkBodyUp,
  onMarkHandleStart,
  onMarkHandleMove,
  onMarkHandleEnd,
  hasTextSelection,
  shouldBlockTapActions,
  onEngineSelection,
  onLongPress,
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
  getHighlightColor: () => settingsStore.settings.highlightColor || HIGHLIGHT_COLORS[0],
  setHighlightColor: (c) => {
    void settingsStore.update({ highlightColor: c })
  },
})

const {
  searchQuery,
  searchHits,
  searchBusy,
  searchFeedback,
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
  clearSelectionBar,
  openTtsPanel: () => openPanel('tts'),
})

const {
  onStageWheel,
  onEngineWheel,
  onEdgeTurn,
  onStageClick,
  onContentTap,
  onContentGesture,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
  onStagePointerCancel,
} = useReaderGestures({
  engine,
  book,
  panel,
  stageRef,
  pageTurn: () => settings.value.pageTurn,
  turnProfile: () => turnProfile.value,
  shouldBlockTapActions,
  hasTextSelection,
  markMode,
  selectionBar,
  getIgnoreTapUntil,
  clearSelectionBar,
  onMarkBodyDown,
  onMarkBodyMove,
  onMarkBodyUp,
  onLongPress,
  toggleChrome,
  closePanel,
})

wheelHandler.fn = onEngineWheel
gestureHandler.fn = onContentGesture
tapHandler.fn = (ev: ContentTapEvent) => {
  const s = settings.value
  if (
    book.value?.format === 'txt' &&
    s.pageTurn === 'scroll' &&
    s.autoScrollSpeed > 0 &&
    !ev.isLink &&
    !ev.hasSelection
  ) {
    const paused = engine.value?.toggleAutoScrollPause?.()
    if (paused === 'paused' || paused === 'running') {
      flashStatus(paused === 'paused' ? '已暂停自动滚屏' : '继续自动滚屏')
      return
    }
  }
  onContentTap(ev)
}
selectionHandler.fn = onEngineSelection

function onStagePointerUpCombined(e: PointerEvent) {
  onStagePointerUp(e)
  onPointerUp()
}

function syncPageTheme() {
  const el = pageRef.value
  if (!el) return
  const vars = THEME_VARS[themeMode.value]
  Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v))
}

watch(themeMode, () => {
  syncPageTheme()
  applySettings()
})

watch(chromeVisible, async () => {
  await nextTick()
  // Desktop bar chrome changes stage size; float chrome changes PDF fit insets.
  const fmt = book.value?.format
  if (desktopUi.value) {
    requestAnimationFrame(() => engine.value?.resizeToContainer?.())
    return
  }
  // Float overlay: EPUB skip full resize (column shake); PDF/TXT re-fit visible box.
  if (fmt === 'pdf' || fmt === 'txt') {
    requestAnimationFrame(() => engine.value?.resizeToContainer?.())
  }
})

watch(
  () => settingsStore.settings.pageTurn,
  (mode, prev) => {
    if (prev && mode !== prev) {
      flashStatus(
        mode === 'scroll'
          ? '已切换：上下滑动'
          : mode === 'curl'
            ? '已切换：仿真'
            : '已切换：横滑',
      )
    }
  },
)

watch(
  () => settingsStore.settings.dualColumn,
  (on, prev) => {
    if (prev === undefined || on === prev) return
    if (settingsStore.settings.pageTurn === 'scroll') {
      flashStatus(on ? '双栏将在横滑 / 仿真下生效' : '已关闭双栏')
      return
    }
    if (on && !viewportWide.value) {
      flashStatus('双栏需屏幕宽度 ≥ 1100px')
      return
    }
    flashStatus(on ? '已开启双栏' : '已关闭双栏')
  },
)

watch(
  () => settingsStore.settings.appearanceMode,
  (mode, prev) => {
    if (!prev || mode === prev) return
    flashStatus(
      mode === 'system' ? '外观：跟随系统' : mode === 'schedule' ? '外观：定时深色' : '外观：手动',
    )
    bumpThemeTick()
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
  else if ((e.key === 'b' || e.key === 'B') && engine.value?.capabilities.annotations !== false) {
    void addBookmark()
  } else if (e.key === 'f' || e.key === 'F') {
    const el = document.documentElement
    if (!document.fullscreenElement) void el.requestFullscreen?.()
    else void document.exitFullscreen?.()
  } else if (e.key === '/' && engine.value?.capabilities.search !== false) {
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
  turnProfile.value = resolveTurnProfile()
  const wide = window.innerWidth >= 1100
  if (wide !== viewportWide.value) {
    viewportWide.value = wide
    applySettings()
  } else {
    viewportWide.value = wide
  }
}

/** Edge width CSS var for tap zones (phone ~30%, desktop fine ~9%). */
const fitInsetStyle = computed(() => ({
  '--edge-width': `${turnProfile.value.edgeWidth * 100}%`,
}))

let visualViewportTimer: number | null = null
function onVisualViewportChange() {
  if (visualViewportTimer) window.clearTimeout(visualViewportTimer)
  visualViewportTimer = window.setTimeout(() => {
    visualViewportTimer = null
    const fmt = book.value?.format
    if (fmt === 'pdf' || fmt === 'txt') {
      engine.value?.resizeToContainer?.()
    }
  }, 120)
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
    title: '删除这本书',
    message: `确定删除「${book.value.title}」？\n将返回书架，阅读进度与笔记也会删除。`,
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
  enableProgressSave()
  flushProgress()
  window.setTimeout(() => {
    toc.value = eng.getToc()
  }, 400)
  eng.applyAnnotations?.(annots.value)
}

onMounted(async () => {
  refreshPointerMode()
  window.addEventListener('resize', refreshPointerMode)
  window.visualViewport?.addEventListener('resize', onVisualViewportChange)
  window.visualViewport?.addEventListener('scroll', onVisualViewportChange)
  systemColorMql = window.matchMedia('(prefers-color-scheme: dark)')
  systemColorMql.addEventListener('change', onSystemColorScheme)
  themeTickTimer = window.setInterval(bumpThemeTick, 60_000)
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
  window.visualViewport?.removeEventListener('resize', onVisualViewportChange)
  window.visualViewport?.removeEventListener('scroll', onVisualViewportChange)
  if (visualViewportTimer) window.clearTimeout(visualViewportTimer)
  visualViewportTimer = null
  systemColorMql?.removeEventListener('change', onSystemColorScheme)
  systemColorMql = null
  if (themeTickTimer) window.clearInterval(themeTickTimer)
  themeTickTimer = null
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
    :class="{
      desktop: desktopUi,
      'chrome-float': floatChrome,
      'chrome-on': floatChrome && chromeVisible,
      'annot-active': annotUiActive,
      'mark-mode': markMode,
      'panel-open': panel !== 'none',
    }"
    :data-turn="settings.pageTurn"
    :data-theme="themeMode"
    :data-device="turnProfile.device"
    :data-anim="turnProfile.curlAnim"
    :data-pointer="turnProfile.fine ? 'fine' : 'coarse'"
    :style="fitInsetStyle"
  >
    <header
      v-if="!floatChrome"
      v-show="chromeVisible"
      class="reader-chrome"
      @mousedown="clearUiSelection"
    >
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
        <button
          v-if="engine?.capabilities.search !== false"
          class="btn ghost"
          @click="openPanel('search')"
        >
          搜索
        </button>
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

    <div
      ref="stageRef"
      class="reader-stage"
      @pointerdown="onStagePointerDown"
      @pointermove="onStagePointerMove"
      @pointerup="onStagePointerUpCombined"
      @pointercancel="onStagePointerCancel"
      @click="onStageClick"
    >
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

    <div
      v-if="markMode && !selectionBar"
      class="mark-mode-hint"
      role="status"
      @click.stop
      @pointerdown.stop
    >
      <span>划线中 · 拖选文字，拖绿点调范围</span>
      <button type="button" class="btn ghost" @click="clearSelectionBar">关闭</button>
    </div>

    <ReaderMarkHandles
      v-if="markMode && markHandles"
      :start-x="markHandles.start.x"
      :start-y="markHandles.start.y"
      :start-h="markHandles.start.h"
      :end-x="markHandles.end.x"
      :end-y="markHandles.end.y"
      :end-h="markHandles.end.h"
      @handle-start="(which, e) => onMarkHandleStart(which, e.clientX, e.clientY)"
      @handle-move="(e) => onMarkHandleMove(e.clientX, e.clientY)"
      @handle-end="onMarkHandleEnd"
    />

    <ReaderSelectionBar
      v-if="selectionBar"
      :left="selectionBar.left"
      :top="selectionBar.top"
      :show-highlights="engine?.capabilities.textHighlights !== false"
      :selected-color="settings.highlightColor"
      @select-color="(c) => settingsStore.update({ highlightColor: c })"
      @highlight="addHighlight"
      @copy="copySelection"
      @speak="speakSelection"
      @lookup="lookupWord"
      @close="clearSelectionBar"
    />

    <footer
      v-if="!floatChrome"
      v-show="chromeVisible"
      class="reader-chrome bottom"
      @mousedown="clearUiSelection"
    >
      <button class="btn ghost" @click="engine?.prev()">
        {{ settings.pageTurn === 'scroll' ? '上翻' : '上一页' }}
      </button>
      <div class="chrome-progress">
        <div
          class="progress-bar seekable"
          role="slider"
          tabindex="0"
          :aria-valuenow="Math.round(percent)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuetext="pageLabel"
          :title="`进度 ${formatPercent(percent)} · 点击跳转`"
          @click.stop="onProgressSeek"
          @keydown="onProgressKey"
        >
          <span :style="{ width: formatPercent(percent) }" />
        </div>
        <span class="chrome-percent" :title="formatPercent(percent)">{{ pageLabel }}</span>
      </div>
      <button
        v-if="engine?.capabilities.annotations !== false"
        class="btn ghost"
        title="添加书签"
        @click="addBookmark"
      >
        书签
      </button>
      <button
        v-if="engine?.capabilities.annotations !== false"
        class="btn ghost"
        title="笔记与书签列表"
        @click="openPanel('annot')"
      >
        笔记
      </button>
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
      <button class="btn ghost" @click="engine?.next()">
        {{ settings.pageTurn === 'scroll' ? '下翻' : '下一页' }}
      </button>
    </footer>

    <!-- Mobile / tablet: one job per control — no duplicate panel entries -->
    <div
      v-if="floatChrome && chromeVisible"
      class="reader-float-chrome"
      @mousedown="clearUiSelection"
    >
      <div class="float-top">
        <button type="button" class="float-icon" title="返回书架" @click="back">‹</button>
      </div>

      <button
        type="button"
        class="float-tts"
        :class="{ active: ttsSpeaking }"
        :title="ttsSpeaking ? '停止朗读' : '朗读（长按打开设置）'"
        @pointerdown="onTtsPlayPointerDown"
        @pointerup="onTtsPlayPointerUp"
        @pointerleave="onTtsPlayPointerCancel"
        @pointercancel="onTtsPlayPointerCancel"
        @click="onTtsPlayClick"
      >
        {{ ttsSpeaking ? '停' : '听' }}
      </button>

      <div class="float-bottom">
        <div class="float-progress-row">
          <div
            class="progress-bar seekable float-progress-bar"
            role="slider"
            tabindex="0"
            :aria-valuenow="Math.round(percent)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuetext="pageLabel"
            :title="`进度 ${formatPercent(percent)} · 点击跳转`"
            @click.stop="onProgressSeek"
            @keydown="onProgressKey"
          >
            <span :style="{ width: formatPercent(percent) }" />
          </div>
          <span class="float-page" :title="formatPercent(percent)">{{ pageLabel }}</span>
        </div>
        <nav class="float-toolbar" aria-label="阅读工具">
          <button type="button" class="float-tool" title="目录" @click="openPanel('toc')">
            <span class="float-tool-ico" aria-hidden="true">☰</span>
            <span class="float-tool-label">目录</span>
          </button>
          <button type="button" class="float-tool" title="排版与主题" @click="openPanel('settings')">
            <span class="float-tool-ico" aria-hidden="true">Aa</span>
            <span class="float-tool-label">排版</span>
          </button>
          <button
            v-if="engine?.capabilities.annotations !== false"
            type="button"
            class="float-tool"
            title="笔记与书签"
            @click="openPanel('annot')"
          >
            <span class="float-tool-ico" aria-hidden="true">✎</span>
            <span class="float-tool-label">笔记</span>
          </button>
          <button type="button" class="float-tool" title="更多" @click="openPanel('more')">
            <span class="float-tool-ico" aria-hidden="true">⋯</span>
            <span class="float-tool-label">更多</span>
          </button>
        </nav>
      </div>
    </div>

    <div
      v-if="panel !== 'none'"
      class="reader-backdrop"
      aria-hidden="true"
      @click="closePanel"
      @wheel.prevent
    />

    <ReaderTocPanel
      :open="panel === 'toc'"
      :toc="toc"
      :sheet="floatChrome"
      @close="closePanel"
      @select="goToc"
    />

    <ReaderSearchPanel
      :open="panel === 'search'"
      :query="searchQuery"
      :hits="searchHits"
      :busy="searchBusy"
      :feedback="searchFeedback"
      :offer-ocr="offerOcr"
      :ocr-busy="ocrBusy"
      :ocr-progress="ocrProgress"
      :search-progress="searchProgress"
      :can-ocr="engine?.capabilities.offlineOcr === true"
      :snippet-html="snippetHtml"
      :sheet="floatChrome"
      @close="closePanel"
      @update:query="onSearchQuery"
      @search="runSearch"
      @ocr-search="runOcrSearch"
      @cancel-ocr="cancelOcr"
      @clear="clearSearch"
      @select="goHit"
    />

    <ReaderAnnotPanel
      :open="panel === 'annot'"
      :annots="annots"
      :book="book"
      :sheet="floatChrome"
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
      :theme-tick="themeTick"
      :viewport-wide="viewportWide"
      :sheet="floatChrome"
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
      :sheet="floatChrome"
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
      :sheet="floatChrome"
      :can-search="engine?.capabilities.search !== false"
      :can-annot="engine?.capabilities.annotations !== false"
      @close="closePanel"
      @delete="confirmDeleteBook"
      @search="openPanel('search')"
      @bookmark="addBookmark"
      @tts="openPanel('tts')"
    />
  </div>
</template>
