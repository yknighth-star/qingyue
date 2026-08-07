<script setup lang="ts">
import type { BookRecord } from '@/types'

defineProps<{
  open: boolean
  book: BookRecord | null
  totalMinutes: number
  desktopUi: boolean
  /** Mobile bottom sheet */
  sheet?: boolean
  canSearch?: boolean
  canAnnot?: boolean
}>()

const emit = defineEmits<{
  close: []
  delete: []
  search: []
  bookmark: []
  tts: []
}>()

function formatLabel(format?: string) {
  if (!format) return '未知'
  return format.toUpperCase()
}

function storageLabel(storage?: string) {
  if (storage === 'fs') return '关联目录'
  if (storage === 'idb') return '本机存储'
  return storage || '—'
}
</script>

<template>
  <aside class="panel more-panel" :class="{ open, 'panel-sheet': sheet }">
    <div v-if="sheet" class="panel-sheet-handle" aria-hidden="true" />
    <div class="panel-header more-header">
      <strong>更多</strong>
      <button type="button" class="btn ghost more-close" @click="emit('close')">关闭</button>
    </div>

    <div class="panel-body more-body">
      <section class="more-card" aria-label="书籍信息">
        <h3 class="more-book-title">{{ book?.title || '未命名' }}</h3>
        <div class="more-meta">
          <span class="more-chip">{{ formatLabel(book?.format) }}</span>
          <span class="more-chip">{{ storageLabel(book?.storage) }}</span>
          <span class="more-chip">已读 {{ Math.round(totalMinutes) }} 分钟</span>
        </div>
        <p v-if="book?.fsPath" class="more-path" :title="book.fsPath">{{ book.fsPath }}</p>
      </section>

      <section v-if="!desktopUi" class="more-list" aria-label="快捷操作">
        <button
          v-if="canSearch !== false"
          type="button"
          class="more-row"
          @click="emit('search')"
        >
          <span class="more-row-ico" aria-hidden="true">⌕</span>
          <span class="more-row-text">
            <span class="more-row-title">搜索正文</span>
            <span class="more-row-desc">在当前书中查找关键词</span>
          </span>
          <span class="more-row-chev" aria-hidden="true">›</span>
        </button>
        <button
          v-if="canAnnot !== false"
          type="button"
          class="more-row"
          @click="emit('bookmark')"
        >
          <span class="more-row-ico" aria-hidden="true">⚑</span>
          <span class="more-row-text">
            <span class="more-row-title">添加书签</span>
            <span class="more-row-desc">标记当前位置</span>
          </span>
          <span class="more-row-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" class="more-row" @click="emit('tts')">
          <span class="more-row-ico" aria-hidden="true">♪</span>
          <span class="more-row-text">
            <span class="more-row-title">朗读设置</span>
            <span class="more-row-desc">语音、语速与试听</span>
          </span>
          <span class="more-row-chev" aria-hidden="true">›</span>
        </button>
      </section>

      <p class="more-hint">
        <template v-if="desktopUi">
          快捷键：←/→/空格翻页 · T 目录 · B 书签 · / 搜索 · F 全屏
        </template>
        <template v-else>
          点空白显隐菜单 · 左右滑或点两侧翻页 · 「听」点按朗读、长按设置
        </template>
      </p>

      <button type="button" class="more-danger" @click="emit('delete')">删除此文件</button>
    </div>
  </aside>
</template>

<style scoped>
.more-header {
  border-bottom-color: color-mix(in srgb, var(--fg, #1a1f2e) 10%, transparent);
}

.more-close {
  min-width: 4rem;
}

.more-body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding-bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
}

.more-card {
  padding: 0.95rem 1rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--fg, #1a1f2e) 4.5%, transparent);
  border: 1px solid color-mix(in srgb, var(--fg, #1a1f2e) 8%, transparent);
}

.more-book-title {
  margin: 0 0 0.65rem;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.35;
  word-break: break-word;
}

.more-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.more-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--fg, #1a1f2e) 72%, transparent);
  background: color-mix(in srgb, var(--fg, #1a1f2e) 7%, transparent);
}

.more-path {
  margin: 0.65rem 0 0;
  font-size: 0.72rem;
  line-height: 1.4;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more-list {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--fg, #1a1f2e) 8%, transparent);
  background: color-mix(in srgb, var(--bg-elevated, #fff) 92%, transparent);
}

.more-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  margin: 0;
  padding: 0.85rem 0.9rem;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--fg, #1a1f2e) 7%, transparent);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.more-row:last-child {
  border-bottom: none;
}

.more-row:active {
  background: color-mix(in srgb, var(--accent, #c4a574) 12%, transparent);
}

.more-row-ico {
  flex: 0 0 2rem;
  width: 2rem;
  height: 2rem;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 0.95rem;
  background: color-mix(in srgb, var(--accent, #c4a574) 18%, transparent);
  color: color-mix(in srgb, var(--fg, #1a1f2e) 85%, var(--accent, #c4a574));
}

.more-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.more-row-title {
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.25;
}

.more-row-desc {
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.3;
}

.more-row-chev {
  flex-shrink: 0;
  font-size: 1.15rem;
  color: var(--muted);
  opacity: 0.7;
}

.more-hint {
  margin: 0;
  padding: 0 0.15rem;
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--muted);
}

.more-danger {
  width: 100%;
  margin-top: 0.15rem;
  padding: 0.85rem 1rem;
  border: none;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 650;
  color: #fff;
  background: #c45c5c;
  cursor: pointer;
}

.more-danger:active {
  filter: brightness(0.95);
}
</style>
