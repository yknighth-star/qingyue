<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { BookRecord } from '@/types'
import { displayAuthor } from '@/utils/author'
import { formatBytes, formatPercent } from '@/utils/format'
import { hasStartedReading, readingProgressLabel } from '@/utils/readingProgress'
import { useBooksStore } from '@/stores/books'

const props = defineProps<{
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
const menuBook = ref<BookRecord | null>(null)
const menuStyle = ref<Record<string, string>>({})
const longPressTimer = ref<number | null>(null)
let suppressOpen = false

const MENU_INSET = 4
const MENU_PAD = 8
const MENU_GAP = 4

function findBook(id: string): BookRecord | undefined {
  return props.books.find((x) => x.id === id) || store.books.find((x) => x.id === id)
}

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

/** Keep menu inside the book card (width + vertical) on phone / tablet / PC. */
function placeMenuNear(anchor: HTMLElement, menuEl?: HTMLElement | null) {
  const card = anchor.closest('.book-card') as HTMLElement | null
  const cardRect = card?.getBoundingClientRect()
  const btnRect = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left: number
  let width: number
  if (cardRect && cardRect.width > 40) {
    left = cardRect.left + MENU_INSET
    width = Math.max(72, cardRect.width - MENU_INSET * 2)
  } else {
    width = Math.min(148, vw - MENU_PAD * 2)
    left = Math.max(MENU_PAD, Math.min(btnRect.right - width, vw - width - MENU_PAD))
  }

  const estimatedH = menuEl?.offsetHeight || 120
  let top: number

  if (cardRect && cardRect.height > 80) {
    const cardTop = cardRect.top + MENU_INSET
    const cardBottom = cardRect.bottom - MENU_INSET
    // Prefer above ⋯ so the panel stays inside the card (PC was opening below → 越界).
    const above = btnRect.top - estimatedH - MENU_GAP
    if (above >= cardTop) {
      top = above
    } else {
      // Not enough room above button: dock under card top (overlaps cover, still in-bounds).
      top = cardTop
    }
    // Clamp so the menu bottom does not leave the card.
    if (top + estimatedH > cardBottom) {
      top = Math.max(cardTop, cardBottom - estimatedH)
    }
  } else {
    const above = btnRect.top - estimatedH - MENU_GAP
    top = above >= MENU_PAD ? above : btnRect.bottom + MENU_GAP
  }

  top = Math.max(MENU_PAD, Math.min(top, vh - MENU_PAD - 48))

  if (left + width > vw - MENU_PAD) {
    left = Math.max(MENU_PAD, vw - width - MENU_PAD)
  }
  if (left < MENU_PAD) left = MENU_PAD

  menuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    zIndex: '80',
  }
}

function bookMoreBtn(id: string): HTMLElement | null {
  const safe =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return document.querySelector(`.book-card[data-book-id="${safe}"] .book-more-btn`) as HTMLElement | null
}

async function openMenuFor(b: BookRecord, anchor?: HTMLElement | null) {
  const el = anchor || bookMoreBtn(b.id)
  // Place coords BEFORE mounting portal — avoids static→fixed flash that blinks covers.
  if (el) placeMenuNear(el, null)
  menuId.value = b.id
  menuBook.value = b
  await nextTick()
  const menuEl = document.querySelector('.book-card-menu-portal') as HTMLElement | null
  if (el && menuEl) placeMenuNear(el, menuEl)
}

function toggleMenu(id: string, e?: Event) {
  e?.stopPropagation()
  e?.preventDefault()
  if (menuId.value === id) {
    closeMenu()
    return
  }
  const record = findBook(id)
  if (!record) return
  void openMenuFor(record, (e?.currentTarget as HTMLElement) || null)
}

function closeMenu() {
  menuId.value = null
  menuBook.value = null
  menuStyle.value = {}
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
  if (!t?.closest?.('.book-card-menu-wrap, .book-card-menu')) closeMenu()
}

function onViewportChange() {
  if (!menuId.value || !menuBook.value) return
  const el = bookMoreBtn(menuId.value)
  const menuEl = document.querySelector('.book-card-menu-portal') as HTMLElement | null
  if (el) placeMenuNear(el, menuEl)
  else closeMenu()
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
    const btn = (e.currentTarget as HTMLElement | null)?.querySelector?.(
      '.book-more-btn',
    ) as HTMLElement | null
    void openMenuFor(b, btn)
  }, 520)
}

function onCardPointerUp() {
  clearLongPress()
}

function onCardContextMenu(b: BookRecord, e: Event) {
  e.preventDefault()
  suppressOpen = true
  const btn = (e.currentTarget as HTMLElement | null)?.querySelector?.(
    '.book-more-btn',
  ) as HTMLElement | null
  void openMenuFor(b, btn)
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
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
      :data-book-id="b.id"
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
          </div>
        </div>
      </div>
    </article>

    <Teleport to="body">
      <div
        v-if="menuBook && menuId === menuBook.id"
        class="book-card-menu book-card-menu-portal"
        role="menu"
        :style="menuStyle"
        @click.stop
      >
        <p class="book-card-menu-meta">
          {{ formatBytes(menuBook.fileSize) }} · {{ menuBook.format.toUpperCase() }}
        </p>
        <button type="button" class="book-card-menu-item" role="menuitem" @click="onEdit(menuBook)">
          编辑信息
        </button>
        <button
          type="button"
          class="book-card-menu-item danger"
          role="menuitem"
          @click="onRemove(menuBook)"
        >
          删除
        </button>
      </div>
    </Teleport>
  </div>
</template>
