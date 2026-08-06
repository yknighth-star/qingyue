<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SearchHit } from '@/types'

const props = defineProps<{
  open: boolean
  query: string
  hits: SearchHit[]
  busy: boolean
  feedback: 'idle' | 'need-query' | 'done'
  snippetHtml: (snippet: string) => string
}>()

const emit = defineEmits<{
  close: []
  'update:query': [value: string]
  search: []
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
          {{ busy ? '搜索中…' : '搜索' }}
        </button>
        <button
          class="btn ghost"
          :disabled="busy || (!query && !hits.length && feedback === 'idle')"
          @click="emit('clear')"
        >
          清空
        </button>
      </div>
      <p v-if="busy" style="color: var(--muted); margin-top: 0.75rem">正在搜索全书…</p>
      <p v-else-if="feedback === 'need-query'" style="color: var(--muted); margin-top: 0.75rem">
        请输入关键词
      </p>
      <p
        v-else-if="feedback === 'done' && !hits.length"
        style="color: var(--muted); margin-top: 0.75rem"
      >
        未找到「{{ query.trim() }}」
      </p>
      <p
        v-else-if="feedback === 'done' && hits.length"
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
    </div>
  </aside>
</template>
