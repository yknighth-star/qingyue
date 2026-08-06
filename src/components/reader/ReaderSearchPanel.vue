<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SearchHit } from '@/types'

const props = defineProps<{
  open: boolean
  query: string
  hits: SearchHit[]
  busy: boolean
  feedback: 'idle' | 'need-query' | 'done'
  offerOcr?: boolean
  ocrBusy?: boolean
  ocrProgress?: { page: number; total: number } | null
  searchProgress?: { page: number; total: number } | null
  canOcr?: boolean
  snippetHtml: (snippet: string) => string
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  search: []
  ocrSearch: []
  cancelOcr: []
  clear: []
  select: [hit: SearchHit]
}>()

const inputRef = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      requestAnimationFrame(() => inputRef.value?.focus())
    }
  },
)

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<template>
  <aside class="panel" :class="{ open }">
    <div class="panel-header">
      <strong>搜索</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body">
      <div class="field">
        <input
          ref="inputRef"
          :value="query"
          placeholder="输入关键词"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown.enter="emit('search')"
        />
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
        <button class="btn primary" :disabled="busy" @click="emit('search')">
          {{ busy && !ocrBusy ? '搜索中…' : '搜索' }}
        </button>
        <button
          class="btn ghost"
          :disabled="busy || (!query && !hits.length && feedback === 'idle')"
          @click="emit('clear')"
        >
          清空
        </button>
      </div>

      <p v-if="ocrBusy" style="color: var(--muted); margin-top: 0.75rem">
        离线 OCR 识别中
        <template v-if="ocrProgress?.total">
          （{{ ocrProgress.page }}/{{ ocrProgress.total }} 页）
        </template>
        <template v-if="hits.length"> · 已找到 {{ hits.length }} 处</template>
        …
        <button
          type="button"
          class="btn ghost"
          style="margin-left: 0.35rem"
          @click="emit('cancelOcr')"
        >
          取消
        </button>
      </p>
      <p v-else-if="busy" style="color: var(--muted); margin-top: 0.75rem">
        正在搜索全书
        <template v-if="searchProgress?.total">
          （{{ searchProgress.page }}/{{ searchProgress.total }}）
        </template>
        <template v-if="hits.length"> · 已找到 {{ hits.length }} 处，可先点击跳转</template>
        …
      </p>
      <p v-else-if="feedback === 'need-query'" style="color: var(--muted); margin-top: 0.75rem">
        请输入关键词
      </p>
      <template v-else-if="feedback === 'done' && !hits.length && !busy">
        <p style="color: var(--muted); margin-top: 0.75rem">未找到「{{ query.trim() }}」</p>
        <div v-if="offerOcr && canOcr" class="ocr-offer">
          <p style="color: var(--muted); font-size: 0.85rem; margin: 0.5rem 0">
            未命中嵌入文字。若页面上能看见该词，可试离线 OCR（本机识别，不上传）。
          </p>
          <button class="btn primary" :disabled="busy" @click="emit('ocrSearch')">
            离线 OCR 后重搜
          </button>
        </div>
      </template>
      <p
        v-else-if="!busy && feedback === 'done' && hits.length"
        style="color: var(--muted); margin-top: 0.75rem; font-size: 0.85rem"
      >
        找到 {{ hits.length }} 处，点击跳转
      </p>
      <div
        v-for="(h, i) in hits"
        :key="i"
        class="panel-item"
        @click="emit('select', h)"
        v-html="snippetHtml(h.snippet)"
      />
      <p
        v-if="canOcr && feedback === 'idle' && !busy"
        style="color: var(--muted); font-size: 0.8rem; margin-top: 1rem"
      >
        扫描版 PDF：普通搜索无结果时可选用离线 OCR（较慢，前 80 页）。
      </p>
    </div>
  </aside>
</template>
