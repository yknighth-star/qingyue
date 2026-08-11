<script setup lang="ts">
import { computed } from 'vue'
import TocTree from '@/components/TocTree.vue'
import type { TocItem } from '@/types'

const props = defineProps<{
  open: boolean
  toc: TocItem[]
  /** Mobile: bottom sheet instead of right drawer */
  sheet?: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [item: TocItem]
}>()

/** Huge CN-novel TOCs: expanding all nodes freezes the UI. */
const LARGE_TOC_EXPAND_CAP = 80

function countTocNodes(items: TocItem[]): number {
  let n = 0
  for (const item of items) {
    n += 1
    if (item.children?.length) n += countTocNodes(item.children)
  }
  return n
}

const defaultExpand = computed(() => countTocNodes(props.toc) < LARGE_TOC_EXPAND_CAP)
</script>

<template>
  <aside class="panel panel-sheet-tall" :class="{ open, 'panel-sheet': sheet }">
    <div v-if="sheet" class="panel-sheet-handle" aria-hidden="true" />
    <div class="panel-header">
      <strong>目录</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body toc-panel-body">
      <TocTree
        v-if="toc.length"
        :items="toc"
        :default-expand="defaultExpand"
        @select="emit('select', $event)"
      />
      <p v-else style="color: var(--muted)">暂无目录。</p>
    </div>
  </aside>
</template>
