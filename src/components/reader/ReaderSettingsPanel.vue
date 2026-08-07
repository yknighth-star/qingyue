<script setup lang="ts">
import { computed } from 'vue'
import {
  FONT_PRESETS,
  type AppearanceMode,
  type BookFormat,
  type ReaderSettings,
} from '@/types'
import {
  appearanceHint,
  autoScrollSpeedLabel,
  DUAL_COLUMN_MIN_WIDTH,
  dualColumnHint,
} from '@/utils/format'

const props = defineProps<{
  open: boolean
  settings: ReaderSettings
  format?: BookFormat
  pageTurnHint: Record<string, string>
  /** 用于定时深色文案刷新 */
  themeTick?: number
  viewportWide?: boolean
  sheet?: boolean
}>()

const emit = defineEmits<{
  close: []
  update: [patch: Partial<ReaderSettings>]
}>()

const wideEnough = computed(() => props.viewportWide ?? true)
const showDualColumn = computed(
  () =>
    (props.format === 'epub' || props.format === 'txt') &&
    props.settings.pageTurn !== 'scroll',
)
const dualColumnInteractive = computed(() => showDualColumn.value && wideEnough.value)
const dualHint = computed(() =>
  dualColumnHint({
    format: props.format,
    pageTurn: props.settings.pageTurn,
    dualColumn: props.settings.dualColumn,
    wideEnough: wideEnough.value,
  }),
)

const showAutoScroll = computed(
  () => props.format === 'txt' && props.settings.pageTurn === 'scroll',
)

const appearanceLabel = computed(() => {
  void props.themeTick
  return appearanceHint(props.settings)
})

function setAppearance(mode: AppearanceMode) {
  emit('update', { appearanceMode: mode })
}

function onDualColumn(checked: boolean) {
  emit('update', { dualColumn: checked })
}

function setAutoScrollPreset(speed: number) {
  emit('update', { autoScrollSpeed: speed })
}

function setTheme(theme: ReaderSettings['theme']) {
  // Selecting a swatch means "use this now" — leave system/schedule so it isn't
  // stuck on dark while only the daytime fallback updates.
  emit('update', { theme, appearanceMode: 'manual' })
}
</script>

<template>
  <aside class="panel panel-sheet-tall" :class="{ open, 'panel-sheet': sheet }">
    <div v-if="sheet" class="panel-sheet-handle" aria-hidden="true" />
    <div class="panel-header">
      <strong>排版</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body">
      <div class="field">
        <label>字号 {{ settings.fontSize }}</label>
        <input
          type="range"
          min="14"
          max="36"
          :value="settings.fontSize"
          @input="emit('update', { fontSize: Number(($event.target as HTMLInputElement).value) })"
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
          @input="emit('update', { lineHeight: Number(($event.target as HTMLInputElement).value) })"
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
          @input="
            emit('update', { paragraphGap: Number(($event.target as HTMLInputElement).value) })
          "
        />
      </div>
      <div class="field">
        <label>左右边距 {{ settings.marginX }}</label>
        <input
          type="range"
          min="8"
          max="64"
          :value="settings.marginX"
          @input="emit('update', { marginX: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>
      <div class="field">
        <label>上下边距 {{ settings.marginY }}</label>
        <input
          type="range"
          min="4"
          max="48"
          :value="settings.marginY"
          @input="emit('update', { marginY: Number(($event.target as HTMLInputElement).value) })"
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
          @input="emit('update', { indent: Number(($event.target as HTMLInputElement).value) })"
        />
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
            @click="emit('update', { fontFamily: f.value })"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <div class="field">
        <label>外观</label>
        <div class="seg-group" role="radiogroup" aria-label="外观">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: (settings.appearanceMode || 'manual') === 'manual' }"
            @click="setAppearance('manual')"
          >
            手动
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.appearanceMode === 'system' }"
            @click="setAppearance('system')"
          >
            跟随系统
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.appearanceMode === 'schedule' }"
            @click="setAppearance('schedule')"
          >
            定时深色
          </button>
        </div>
        <p class="seg-hint">{{ appearanceLabel }}</p>
      </div>

      <div class="field">
        <label>{{ settings.appearanceMode === 'manual' ? '主题色' : '白天主题' }}</label>
        <div class="seg-group" role="radiogroup" aria-label="主题色">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'light' }"
            @click="setTheme('light')"
          >
            浅色
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'dark' }"
            :disabled="settings.appearanceMode === 'system' || settings.appearanceMode === 'schedule'"
            @click="setTheme('dark')"
          >
            深色
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'sepia' }"
            @click="setTheme('sepia')"
          >
            羊皮纸
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'green' }"
            @click="setTheme('green')"
          >
            护眼绿
          </button>
        </div>
      </div>

      <div v-if="settings.appearanceMode === 'schedule'" class="field">
        <label>深色时段 {{ settings.autoDarkStart }}:00 – {{ settings.autoDarkEnd }}:00</label>
        <div class="schedule-row">
          <label class="schedule-inline">
            起
            <input
              type="range"
              min="0"
              max="23"
              :value="settings.autoDarkStart"
              @input="
                emit('update', { autoDarkStart: Number(($event.target as HTMLInputElement).value) })
              "
            />
          </label>
          <label class="schedule-inline">
            止
            <input
              type="range"
              min="0"
              max="23"
              :value="settings.autoDarkEnd"
              @input="
                emit('update', { autoDarkEnd: Number(($event.target as HTMLInputElement).value) })
              "
            />
          </label>
        </div>
      </div>

      <div class="field">
        <label>亮度 {{ settings.brightness }}</label>
        <input
          type="range"
          min="0.5"
          max="1"
          step="0.05"
          :value="settings.brightness"
          @input="emit('update', { brightness: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>

      <div class="field">
        <label>翻页模式</label>
        <div class="seg-group" role="radiogroup" aria-label="翻页模式">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.pageTurn === 'slide' }"
            @click="emit('update', { pageTurn: 'slide' })"
          >
            横滑
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.pageTurn === 'scroll' }"
            @click="emit('update', { pageTurn: 'scroll' })"
          >
            上下滑动
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.pageTurn === 'curl' }"
            @click="emit('update', { pageTurn: 'curl' })"
          >
            仿真
          </button>
        </div>
        <p class="seg-hint">{{ pageTurnHint[settings.pageTurn] }}</p>
      </div>

      <div v-if="showDualColumn" class="field">
        <label>
          <input
            type="checkbox"
            :checked="settings.dualColumn"
            :disabled="!dualColumnInteractive && !settings.dualColumn"
            @change="onDualColumn(($event.target as HTMLInputElement).checked)"
          />
          双栏阅读
        </label>
        <p class="seg-hint">
          {{ dualHint }}
          <template v-if="!wideEnough">（当前需 ≥ {{ DUAL_COLUMN_MIN_WIDTH }}px）</template>
        </p>
      </div>

      <div v-if="showAutoScroll" class="field">
        <label>自动滚屏 · {{ autoScrollSpeedLabel(settings.autoScrollSpeed) }}</label>
        <div class="seg-group" role="radiogroup" aria-label="自动滚屏">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.autoScrollSpeed <= 0 }"
            @click="setAutoScrollPreset(0)"
          >
            关
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.autoScrollSpeed > 0 && settings.autoScrollSpeed <= 2 }"
            @click="setAutoScrollPreset(2)"
          >
            慢
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.autoScrollSpeed >= 3 && settings.autoScrollSpeed <= 5 }"
            @click="setAutoScrollPreset(4)"
          >
            中
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.autoScrollSpeed >= 6 }"
            @click="setAutoScrollPreset(7)"
          >
            快
          </button>
        </div>
        <p class="seg-hint">轻触正文可暂停 / 继续；离开上下滑动会自动停</p>
      </div>

      <div v-if="format === 'pdf'" class="field">
        <label>PDF 画质</label>
        <div class="seg-group quality-seg" role="radiogroup" aria-label="PDF 画质">
          <button
            type="button"
            class="seg-btn quality-seg-btn"
            :class="{ active: (settings.pdfQuality || 'smooth') === 'smooth' }"
            @click="emit('update', { pdfQuality: 'smooth' })"
          >
            <span class="quality-seg-title">流畅</span>
            <span class="quality-seg-desc">更快 · 省电</span>
          </button>
          <button
            type="button"
            class="seg-btn quality-seg-btn"
            :class="{ active: settings.pdfQuality === 'hd' }"
            @click="emit('update', { pdfQuality: 'hd' })"
          >
            <span class="quality-seg-title">高清</span>
            <span class="quality-seg-desc">更清晰 · 更耗</span>
          </button>
        </div>
      </div>
      <div v-if="format === 'pdf'" class="field">
        <label>PDF 缩放 {{ Math.round((settings.pdfZoom ?? 1) * 100) }}%</label>
        <input
          type="range"
          min="0.6"
          max="2.5"
          step="0.1"
          :value="settings.pdfZoom ?? 1"
          @input="emit('update', { pdfZoom: Number(($event.target as HTMLInputElement).value) })"
        />
        <p class="seg-hint">按屏宽适配；与画质叠加影响清晰度与耗电。</p>
      </div>
    </div>
  </aside>
</template>
