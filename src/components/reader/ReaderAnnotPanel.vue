<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AnnotType, AnnotationRecord, BookRecord } from '@/types'

const props = defineProps<{
  open: boolean
  annots: AnnotationRecord[]
  book?: BookRecord | null
  sheet?: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [a: AnnotationRecord]
  remove: [id: string]
  export: [kind: 'md' | 'json']
}>()

type FilterKind = 'all' | 'bookmark' | 'highlight'

const filter = ref<FilterKind>('all')
const exportOpen = ref(false)

const coverUrl = ref<string | null>(null)

watch(
  () => props.book?.cover,
  (blob) => {
    if (coverUrl.value) {
      URL.revokeObjectURL(coverUrl.value)
      coverUrl.value = null
    }
    if (blob) coverUrl.value = URL.createObjectURL(blob)
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      exportOpen.value = false
    }
  },
)

onBeforeUnmount(() => {
  if (coverUrl.value) URL.revokeObjectURL(coverUrl.value)
})

const filtered = computed(() => {
  const list = props.annots
  if (filter.value === 'bookmark') return list.filter((a) => a.type === 'bookmark')
  if (filter.value === 'highlight') return list.filter((a) => a.type === 'highlight' || a.type === 'note')
  return list
})

const counts = computed(() => ({
  all: props.annots.length,
  bookmark: props.annots.filter((a) => a.type === 'bookmark').length,
  highlight: props.annots.filter((a) => a.type === 'highlight' || a.type === 'note').length,
}))

function typeIcon(type: AnnotType) {
  if (type === 'bookmark') return '⚑'
  if (type === 'note') return '✎'
  return 'A'
}

function typeLabel(type: AnnotType) {
  if (type === 'bookmark') return '书签'
  if (type === 'note') return '想法'
  return '划线'
}

function excerpt(a: AnnotationRecord) {
  const t = (a.selectedText || a.note || '').trim()
  if (t) return t.length > 80 ? `${t.slice(0, 80)}…` : t
  return a.type === 'bookmark' ? '书签位置' : '无摘录'
}

function onExport(kind: 'md' | 'json') {
  exportOpen.value = false
  emit('export', kind)
}
</script>

<template>
  <aside class="panel panel-sheet-tall annot-panel" :class="{ open, 'panel-sheet': sheet }">
    <div v-if="sheet" class="panel-sheet-handle" aria-hidden="true" />

    <div class="annot-header">
      <div class="annot-brand">
        <div class="annot-cover" aria-hidden="true">
          <img v-if="coverUrl" :src="coverUrl" alt="" />
          <span v-else class="annot-cover-fallback">{{ (book?.title || '阅').slice(0, 1) }}</span>
        </div>
        <div class="annot-brand-text">
          <strong class="annot-title">{{ book?.title || '笔记' }}</strong>
          <span class="annot-sub">共 {{ annots.length }} 条</span>
        </div>
      </div>
      <div class="annot-header-actions">
        <div class="annot-export-wrap">
          <button
            type="button"
            class="annot-icon-btn"
            title="导出"
            aria-label="导出"
            @click="exportOpen = !exportOpen"
          >
            ⇧
          </button>
          <div v-if="exportOpen" class="annot-export-menu" role="menu">
            <button type="button" role="menuitem" @click="onExport('md')">导出 Markdown</button>
            <button type="button" role="menuitem" @click="onExport('json')">导出 JSON</button>
          </div>
        </div>
        <button type="button" class="annot-icon-btn" title="关闭" aria-label="关闭" @click="emit('close')">
          ×
        </button>
      </div>
    </div>

    <div class="annot-filters" role="tablist" aria-label="笔记筛选">
      <button
        type="button"
        role="tab"
        class="annot-filter"
        :class="{ active: filter === 'all' }"
        :aria-selected="filter === 'all'"
        @click="filter = 'all'"
      >
        全部{{ counts.all ? ` ${counts.all}` : '' }}
      </button>
      <button
        type="button"
        role="tab"
        class="annot-filter"
        :class="{ active: filter === 'bookmark' }"
        :aria-selected="filter === 'bookmark'"
        @click="filter = 'bookmark'"
      >
        书签{{ counts.bookmark ? ` ${counts.bookmark}` : '' }}
      </button>
      <button
        type="button"
        role="tab"
        class="annot-filter"
        :class="{ active: filter === 'highlight' }"
        :aria-selected="filter === 'highlight'"
        @click="filter = 'highlight'"
      >
        划线{{ counts.highlight ? ` ${counts.highlight}` : '' }}
      </button>
    </div>

    <div class="panel-body annot-body">
      <ul v-if="filtered.length" class="annot-list">
        <li v-for="a in filtered" :key="a.id" class="annot-row">
          <button type="button" class="annot-main" @click="emit('select', a)">
            <span class="annot-type-ico" :title="typeLabel(a.type)" aria-hidden="true">{{
              typeIcon(a.type)
            }}</span>
            <span class="annot-main-text">
              <span class="annot-excerpt">{{ excerpt(a) }}</span>
              <span v-if="a.note && a.selectedText" class="annot-note">{{ a.note }}</span>
              <span class="annot-meta">{{ typeLabel(a.type) }} · {{ new Date(a.createdAt).toLocaleString() }}</span>
            </span>
          </button>
          <button
            type="button"
            class="annot-remove"
            title="删除"
            @click.stop="emit('remove', a.id)"
          >
            删除
          </button>
        </li>
      </ul>
      <p v-else class="annot-empty">
        <template v-if="!annots.length">
          暂无笔记。拖选正文保存划线，或在「更多」里添加书签。
        </template>
        <template v-else>当前筛选下没有条目。</template>
      </p>
    </div>
  </aside>
</template>

<style scoped>
.annot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 1rem 0.75rem;
}

.annot-brand {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  flex: 1;
}

.annot-cover {
  flex-shrink: 0;
  width: 2.4rem;
  height: 3.1rem;
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent, #c4a574) 22%, transparent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.annot-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.annot-cover-fallback {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 1rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--fg, #1a1f2e) 75%, transparent);
}

.annot-brand-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.annot-title {
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.annot-sub {
  font-size: 0.75rem;
  color: var(--muted);
}

.annot-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.annot-icon-btn {
  width: 2.1rem;
  height: 2.1rem;
  border: none;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--fg);
  background: color-mix(in srgb, var(--fg, #1a1f2e) 7%, transparent);
  cursor: pointer;
}

.annot-icon-btn:active {
  background: color-mix(in srgb, var(--fg, #1a1f2e) 12%, transparent);
}

.annot-export-wrap {
  position: relative;
}

.annot-export-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 2;
  min-width: 9.5rem;
  padding: 0.35rem;
  border-radius: 12px;
  background: var(--bg-elevated, #fff);
  border: 1px solid color-mix(in srgb, var(--fg, #1a1f2e) 10%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}

.annot-export-menu button {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  font-size: 0.88rem;
  cursor: pointer;
}

.annot-export-menu button:active {
  background: color-mix(in srgb, var(--accent, #c4a574) 14%, transparent);
}

.annot-filters {
  display: flex;
  gap: 0.35rem;
  margin: 0 1rem 0.35rem;
  padding: 0.28rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fg, #1a1f2e) 6%, transparent);
}

.annot-filter {
  flex: 1;
  border: none;
  border-radius: 999px;
  padding: 0.45rem 0.5rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--fg, #1a1f2e) 62%, transparent);
  background: transparent;
  cursor: pointer;
}

.annot-filter.active {
  color: var(--fg);
  background: var(--bg-elevated, #fff);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.annot-body {
  padding-top: 0.5rem;
}

.annot-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.annot-row {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--fg, #1a1f2e) 6%, transparent);
}

.annot-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin: 0;
  padding: 0.85rem 0.25rem 0.85rem 0.15rem;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.annot-main:active {
  opacity: 0.88;
}

.annot-type-ico {
  flex-shrink: 0;
  width: 1.85rem;
  height: 1.85rem;
  margin-top: 0.1rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  font-weight: 700;
  background: color-mix(in srgb, var(--accent, #c4a574) 18%, transparent);
  color: color-mix(in srgb, var(--fg, #1a1f2e) 80%, var(--accent, #c4a574));
}

.annot-main-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.annot-excerpt {
  font-size: 0.95rem;
  line-height: 1.45;
  word-break: break-word;
}

.annot-note {
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.4;
}

.annot-meta {
  font-size: 0.72rem;
  color: var(--muted);
}

.annot-remove {
  flex-shrink: 0;
  align-self: center;
  margin: 0 0.15rem 0 0;
  padding: 0.4rem 0.55rem;
  border: none;
  border-radius: 8px;
  font-size: 0.75rem;
  color: color-mix(in srgb, #c45c5c 85%, transparent);
  background: transparent;
  cursor: pointer;
}

.annot-remove:active {
  background: color-mix(in srgb, #c45c5c 12%, transparent);
}

.annot-empty {
  margin: 1.5rem 0.5rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.55;
}
</style>
