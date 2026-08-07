<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { BookRecord } from '@/types'
import { displayAuthor } from '@/utils/author'
import { formatBytes, formatPercent } from '@/utils/format'
import { hasStartedReading, readingProgressLabel } from '@/utils/readingProgress'
import { useBooksStore } from '@/stores/books'

defineProps<{
  books: BookRecord[]
  coverUrls: Record<string, string>
  coverLabel: (title: string) => string
}>()

const emit = defineEmits<{
  open: [id: string]
  edit: [b: BookRecord]
  remove: [b: BookRecord]
}>()

const store = useBooksStore()
const menuId = ref<string | null>(null)
const longPressTimer = ref<number | null>(null)
let suppressOpen = false

function openBook(id: string) {
  if (suppressOpen) {
    suppressOpen = false
    return
  }
  if (menuId.value) {
    closeMenu()
    return
  }
  emit('open', id)
}

function toggleMenu(id: string, e?: Event) {
  e?.stopPropagation()
  e?.preventDefault()
  menuId.value = menuId.value === id ? null : id
}

function closeMenu() {
  menuId.value = null
}

function onEdit(b: BookRecord) {
  closeMenu()
  emit('edit', b)
}

function onRemove(b: BookRecord) {
  closeMenu()
  emit('remove', b)
}

function onDocPointerDown(e: PointerEvent) {
  const t = e.target as HTMLElement | null
  if (!t?.closest?.('.book-card-menu-wrap')) closeMenu()
}

function clearLongPress() {
  if (longPressTimer.value != null) {
    window.clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
}

function onCardPointerDown(b: BookRecord, e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const t = e.target as HTMLElement | null
  if (t?.closest?.('.book-more-btn, .book-card-menu, .fav-btn')) return
  clearLongPress()
  longPressTimer.value = window.setTimeout(() => {
    longPressTimer.value = null
    suppressOpen = true
    menuId.value = b.id
  }, 520)
}

function onCardPointerUp() {
  clearLongPress()
}

function onCardContextMenu(b: BookRecord, e: Event) {
  e.preventDefault()
  suppressOpen = true
  menuId.value = b.id
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  clearLongPress()
})
</script>

<template>
  <div class="shelf-grid">
    <article
      v-for="b in books"
      :key="b.id"
      class="book-card"
      :data-format="b.format"
      :class="{
        favorite: b.isFavorite,
        started: hasStartedReading(b),
        'menu-open': menuId === b.id,
      }"
      @pointerdown="onCardPointerDown(b, $event)"
      @pointerup="onCardPointerUp"
      @pointercancel="onCardPointerUp"
      @pointerleave="onCardPointerUp"
      @contextmenu="onCardContextMenu(b, $event)"
    >
      <div
        class="cover"
        role="button"
        tabindex="0"
        @click="openBook(b.id)"
        @keydown.enter="openBook(b.id)"
      >
        <img v-if="coverUrls[b.id]" :src="coverUrls[b.id]" :alt="b.title" />
        <div v-else class="cover-fallback">
          <span class="cover-label">{{ coverLabel(b.title) }}</span>
        </div>
        <span class="badge" :data-format="b.format">{{ b.format }}</span>
        <button
          class="fav-btn"
          :class="{ on: b.isFavorite }"
          :title="b.isFavorite ? '取消收藏' : '收藏'"
          @click.stop="store.toggleFavorite(b.id)"
        >
          {{ b.isFavorite ? '★' : '☆' }}
        </button>
        <div v-if="hasStartedReading(b)" class="cover-progress">
          <span
            :style="{
              width: formatPercent(Math.max(b.progressPercent || 0, b.lastReadAt ? 1 : 0)),
            }"
          />
        </div>
      </div>

      <div class="book-meta">
        <div class="book-title" :title="b.title" @click="openBook(b.id)">{{ b.title }}</div>
        <div v-if="displayAuthor(b.author)" class="book-author" :title="displayAuthor(b.author)">
          {{ displayAuthor(b.author) }}
        </div>
        <div class="book-foot">
          <span class="book-pct">{{ readingProgressLabel(b) }}</span>
          <div class="book-card-menu-wrap">
            <button
              type="button"
              class="book-more-btn"
              title="更多"
              aria-label="更多"
              :aria-expanded="menuId === b.id"
              @click="toggleMenu(b.id, $event)"
            >
              <span class="book-more-dots" aria-hidden="true" />
            </button>
            <div v-if="menuId === b.id" class="book-card-menu" role="menu" @click.stop>
              <p class="book-card-menu-meta">{{ formatBytes(b.fileSize) }} · {{ b.format.toUpperCase() }}</p>
              <button type="button" class="book-card-menu-item" role="menuitem" @click="onEdit(b)">
                编辑信息
              </button>
              <button
                type="button"
                class="book-card-menu-item danger"
                role="menuitem"
                @click="onRemove(b)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  </div>
</template>
