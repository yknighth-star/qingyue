<script setup lang="ts">
import type { ReaderSettings } from '@/types'

defineProps<{
  open: boolean
  settings: ReaderSettings
  ttsVoices: SpeechSynthesisVoice[]
  ttsVoiceLabel: string
  ttsSpeaking: boolean
  voiceIdOf: (v: SpeechSynthesisVoice) => string
  voiceOptionLabel: (v: SpeechSynthesisVoice) => string
}>()

const emit = defineEmits<{
  close: []
  'voice-change': [e: Event]
  update: [patch: Partial<ReaderSettings>]
  speak: []
  stop: []
}>()
</script>

<template>
  <aside class="panel" :class="{ open }">
    <div class="panel-header">
      <strong>朗读</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body">
      <p style="color: var(--muted); font-size: 0.85rem; margin-top: 0">
        点底栏「▶ 听」朗读本页；「▾」或长按打开本页设置。选中文字后可用「读选中」。
      </p>
      <div class="field">
        <label>音色</label>
        <select :value="settings.ttsVoiceURI" @change="emit('voice-change', $event)">
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
          @input="emit('update', { ttsRate: Number(($event.target as HTMLInputElement).value) })"
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
          @input="emit('update', { ttsPitch: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>
      <button
        v-if="!ttsSpeaking"
        class="btn primary"
        style="margin-top: 0.25rem; display: block; width: 100%"
        @click="emit('speak')"
      >
        朗读本页
      </button>
      <button
        v-else
        class="btn"
        style="margin-top: 0.25rem; display: block; width: 100%"
        @click="emit('stop')"
      >
        停止朗读
      </button>
    </div>
  </aside>
</template>
