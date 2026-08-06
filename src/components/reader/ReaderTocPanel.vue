<script setup lang="ts">
import TocTree from '@/components/TocTree.vue'
import type { TocItem } from '@/types'

defineProps<{
  open: boolean
  toc: TocItem[]
}>()

const emit = defineEmits<{
  close: []
  select: [item: TocItem]
}>()
</script>

<template>
  <aside class="panel" :class="{ open }">
    <div class="panel-header">
      <strong>目录</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body toc-panel-body">
      <TocTree v-if="toc.length" :items="toc" @select="emit('select', $event)" />
      <p v-else style="color: var(--muted)">暂无目录。</p>
    </div>
  </aside>
</template>
