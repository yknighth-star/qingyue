<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TocItem } from '@/types'

defineOptions({ name: 'TocTree' })

const props = defineProps<{
  items: TocItem[]
  depth?: number
  /** Expand all nodes that have children on first load / when items change */
  defaultExpand?: boolean
}>()

const emit = defineEmits<{
  select: [item: TocItem]
}>()

const depth = () => props.depth ?? 0
const expanded = ref<Set<string>>(new Set())

function itemKey(item: TocItem, index: number) {
  return item.id || `toc-${depth()}-${index}`
}

function hasChildren(item: TocItem) {
  return Boolean(item.children?.length)
}

function isOpen(key: string) {
  return expanded.value.has(key)
}

function toggle(key: string, e: Event) {
  e.stopPropagation()
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function collectExpandable(items: TocItem[], set: Set<string>, d = 0) {
  items.forEach((item, i) => {
    const key = item.id || `toc-${d}-${i}`
    if (item.children?.length) {
      set.add(key)
      collectExpandable(item.children, set, d + 1)
    }
  })
}

watch(
  () => props.items,
  (items) => {
    if (props.defaultExpand === false) {
      expanded.value = new Set()
      return
    }
    const set = new Set<string>()
    collectExpandable(items, set)
    expanded.value = set
  },
  { immediate: true },
)

function onSelect(item: TocItem) {
  emit('select', item)
}
</script>

<template>
  <ul class="toc-tree" :data-depth="depth()">
    <li v-for="(item, index) in items" :key="itemKey(item, index)" class="toc-node">
      <div
        class="toc-row"
        :style="{ paddingLeft: `${0.2 + depth() * 0.9}rem` }"
        @click="onSelect(item)"
      >
        <button
          v-if="hasChildren(item)"
          type="button"
          class="toc-twist"
          :aria-expanded="isOpen(itemKey(item, index))"
          :title="isOpen(itemKey(item, index)) ? '折叠' : '展开'"
          @click="toggle(itemKey(item, index), $event)"
        >
          {{ isOpen(itemKey(item, index)) ? '▾' : '▸' }}
        </button>
        <span v-else class="toc-twist spacer" />
        <span class="toc-label">{{ item.label }}</span>
      </div>
      <TocTree
        v-if="hasChildren(item) && isOpen(itemKey(item, index))"
        :items="item.children!"
        :depth="depth() + 1"
        :default-expand="defaultExpand"
        @select="onSelect"
      />
    </li>
  </ul>
</template>
