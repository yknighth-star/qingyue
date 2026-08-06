<script setup lang="ts">
import type { AnnotationRecord } from '@/types'

defineProps<{
  open: boolean
  annots: AnnotationRecord[]
}>()

const emit = defineEmits<{
  close: []
  select: [a: AnnotationRecord]
  remove: [id: string]
  export: [kind: 'md' | 'json']
}>()
</script>

<template>
  <aside class="panel" :class="{ open }">
    <div class="panel-header">
      <strong>笔记</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body">
      <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem">
        <button class="btn" @click="emit('export', 'md')">导出 MD</button>
        <button class="btn" @click="emit('export', 'json')">导出 JSON</button>
      </div>
      <div v-for="a in annots" :key="a.id" class="panel-item">
        <div @click="emit('select', a)">
          <small
            >{{ a.type === 'bookmark' ? '书签' : '高亮' }} ·
            {{ new Date(a.createdAt).toLocaleString() }}</small
          >
          <div>{{ a.selectedText || '书签位置' }}</div>
          <div v-if="a.note" style="color: var(--muted)">{{ a.note }}</div>
        </div>
        <button class="btn danger" style="margin-top: 0.35rem" @click="emit('remove', a.id)">
          删除
        </button>
      </div>
      <p v-if="!annots.length" style="color: var(--muted)">
        暂无笔记。拖选正文点颜色可保存高亮；底栏「书签」记下位置，「笔记」查看列表。
      </p>
    </div>
  </aside>
</template>
