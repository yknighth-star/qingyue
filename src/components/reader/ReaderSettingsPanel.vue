<script setup lang="ts">
import { FONT_PRESETS, type BookFormat, type ReaderSettings } from '@/types'

defineProps<{
  open: boolean
  settings: ReaderSettings
  format?: BookFormat
  pageTurnHint: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
  update: [patch: Partial<ReaderSettings>]
}>()
</script>

<template>
  <aside class="panel" :class="{ open }">
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
        <label>主题</label>
        <div class="seg-group" role="radiogroup" aria-label="主题">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'light' }"
            @click="emit('update', { theme: 'light' })"
          >
            浅色
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'dark' }"
            @click="emit('update', { theme: 'dark' })"
          >
            深色
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'sepia' }"
            @click="emit('update', { theme: 'sepia' })"
          >
            羊皮纸
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.theme === 'green' }"
            @click="emit('update', { theme: 'green' })"
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
            @click="emit('update', { pageTurn: 'slide' })"
          >
            平移
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: settings.pageTurn === 'scroll' }"
            @click="emit('update', { pageTurn: 'scroll' })"
          >
            滚动
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
      <div class="field">
        <label>自动滚屏速度 {{ settings.autoScrollSpeed }}（0 关闭）</label>
        <input
          type="range"
          min="0"
          max="8"
          step="1"
          :value="settings.autoScrollSpeed"
          @input="
            emit('update', { autoScrollSpeed: Number(($event.target as HTMLInputElement).value) })
          "
        />
      </div>
      <div class="field">
        <label>
          <input
            type="checkbox"
            :checked="settings.dualColumn"
            @change="
              emit('update', { dualColumn: ($event.target as HTMLInputElement).checked })
            "
          />
          宽屏双栏
        </label>
      </div>
      <div class="field">
        <label>
          <input
            type="checkbox"
            :checked="settings.autoDark"
            @change="emit('update', { autoDark: ($event.target as HTMLInputElement).checked })"
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
            @click="emit('update', { fontFamily: f.value })"
          >
            {{ f.label }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
