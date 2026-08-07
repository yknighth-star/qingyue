<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { FormatFilter, ProgressFilter, ShelfSort } from '@/types'
import { useShelfActions, useShelfLifecycle } from '@/composables/useShelfActions'
import ShelfToolbar from '@/components/shelf/ShelfToolbar.vue'
import ShelfBookGrid from '@/components/shelf/ShelfBookGrid.vue'
import ShelfEditDialog from '@/components/shelf/ShelfEditDialog.vue'

const formatOptions: { id: FormatFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'epub', label: 'EPUB' },
  { id: 'txt', label: 'TXT' },
  { id: 'pdf', label: 'PDF' },
]

const progressOptions: { id: ProgressFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'reading', label: '在读' },
  { id: 'done', label: '读完' },
]

const sortOptions: { id: ShelfSort; label: string }[] = [
  { id: 'activity', label: '最近阅读' },
  { id: 'added', label: '最近添加' },
  { id: 'title', label: '书名' },
  { id: 'author', label: '作者' },
]

const {
  books,
  stats,
  fileInput,
  message,
  editing,
  editTitle,
  editAuthor,
  editTags,
  dragging,
  coverUrls,
  hasActiveNarrow,
  clearNarrowFilters,
  onPickFiles,
  onLinkFolder,
  onRescan,
  onDedup,
  onClearLibrary,
  openBook,
  clearUiSelection,
  coverLabel,
  confirmRemove,
  openEdit,
  saveEdit,
  onDrop,
  mount,
  unmount,
  setFilter,
} = useShelfActions()

useShelfLifecycle({ mount, unmount })

const menuOpen = ref(false)
const searchOpen = ref(false)

function closeMenus() {
  menuOpen.value = false
}

function toggleMenu() {
  searchOpen.value = false
  menuOpen.value = !menuOpen.value
}

function openSearch() {
  menuOpen.value = false
  searchOpen.value = true
}

function closeSearch() {
  searchOpen.value = false
}

function triggerImport() {
  closeMenus()
  closeSearch()
  fileInput.value?.click()
}

function runAndClose(fn: () => void | Promise<void>) {
  closeMenus()
  void fn()
}

function onDocPointerDown(e: PointerEvent) {
  const t = e.target as HTMLElement | null
  if (!t?.closest?.('.shelf-menu-wrap')) menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <div
    class="app-shell"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop="onDrop"
  >
    <header class="topbar shelf-topbar" @mousedown="clearUiSelection">
      <div class="brand" @mousedown.prevent>轻阅</div>
      <div class="tabs">
        <button class="tab" :class="{ active: books.filter === 'all' }" @click="setFilter('all')">
          全部
        </button>
        <button
          class="tab"
          :class="{ active: books.filter === 'favorite' }"
          @click="setFilter('favorite')"
        >
          收藏
        </button>
        <button
          class="tab"
          :class="{ active: books.filter === 'recent' }"
          @click="setFilter('recent')"
        >
          最近
        </button>
      </div>
      <div class="spacer" />
      <span v-if="stats.stats.totalMinutes" class="stats-chip shelf-desktop-only">
        阅读 {{ Math.round(stats.stats.totalMinutes) }} 分钟 · 连续 {{ stats.stats.streakDays }} 天
      </span>

      <button
        type="button"
        class="btn shelf-from-tablet"
        title="导入本地书"
        @click="triggerImport"
      >
        导入
      </button>
      <button
        v-if="books.fsSupported"
        type="button"
        class="btn primary shelf-desktop-only"
        :title="books.fsLinkedName ? `已关联目录：${books.fsLinkedName}` : '关联电脑目录，适合大书'"
        @click="onLinkFolder"
      >
        {{ books.fsLinkedName ? `目录: ${books.fsLinkedName}` : '关联目录' }}
      </button>

      <button
        type="button"
        class="shelf-icon-btn shelf-mobile-only"
        :class="{ active: searchOpen || hasActiveNarrow }"
        title="搜索与筛选"
        aria-label="搜索与筛选"
        @click="openSearch"
      >
        <span class="shelf-icon-search" aria-hidden="true" />
        <span v-if="hasActiveNarrow" class="shelf-icon-dot" />
      </button>
      <button
        type="button"
        class="shelf-icon-btn shelf-icon-primary shelf-mobile-only"
        title="导入本地书"
        aria-label="导入本地书"
        @click="triggerImport"
      >
        <span class="shelf-icon-plus" aria-hidden="true" />
      </button>

      <div class="shelf-menu-wrap">
        <button
          type="button"
          class="shelf-icon-btn"
          title="更多"
          aria-label="更多"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @click.stop="toggleMenu"
        >
          <span class="shelf-icon-more" aria-hidden="true" />
        </button>
        <div v-if="menuOpen" class="shelf-menu" role="menu" @click.stop>
          <button type="button" class="shelf-menu-item shelf-mobile-only" role="menuitem" @click="triggerImport">
            导入本地书
          </button>
          <button
            v-if="books.fsSupported"
            type="button"
            class="shelf-menu-item shelf-hide-desktop"
            role="menuitem"
            @click="runAndClose(onLinkFolder)"
          >
            {{ books.fsLinkedName ? `关联目录：${books.fsLinkedName}` : '关联目录' }}
          </button>
          <button
            v-if="books.fsLinkedName"
            type="button"
            class="shelf-menu-item"
            role="menuitem"
            @click="runAndClose(onRescan)"
          >
            同步目录
          </button>
          <button type="button" class="shelf-menu-item" role="menuitem" @click="runAndClose(onDedup)">
            去除重复
          </button>
          <button
            type="button"
            class="shelf-menu-item danger"
            role="menuitem"
            @click="runAndClose(onClearLibrary)"
          >
            清空书架
          </button>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        hidden
        multiple
        accept=".epub,.txt,.pdf,application/epub+zip,text/plain,application/pdf"
        @change="onPickFiles"
      />
    </header>

    <div v-if="books.quotaWarning" class="warn">{{ books.quotaWarning }}</div>
    <div v-if="message" class="warn">{{ message }}</div>
    <div v-if="dragging" class="warn">松开以导入书籍…</div>

    <ShelfToolbar
      class="shelf-toolbar-bar"
      :format-options="formatOptions"
      :progress-options="progressOptions"
      :sort-options="sortOptions"
    />

    <div v-if="searchOpen" class="shelf-search-sheet" @keydown.escape="closeSearch">
      <div class="shelf-search-sheet-head">
        <strong>搜索与筛选</strong>
        <button type="button" class="btn ghost" @click="closeSearch">完成</button>
      </div>
      <ShelfToolbar
        force-show
        :format-options="formatOptions"
        :progress-options="progressOptions"
        :sort-options="sortOptions"
      />
      <p v-if="hasActiveNarrow" class="shelf-search-sheet-hint">
        <button type="button" class="btn ghost" @click="clearNarrowFilters">清除筛选</button>
      </p>
    </div>

    <div v-if="!books.books.length" class="empty">
      <h2>书架还是空的</h2>
      <p>导入 EPUB、TXT 或 PDF，开始阅读。桌面 Chrome / Edge 也可关联目录读取大书。</p>
      <p style="margin-top: 1rem">
        <button class="btn primary" @click="triggerImport">导入本地书</button>
      </p>
    </div>

    <div v-else-if="!books.filtered.length" class="empty">
      <h2>没有匹配的书</h2>
      <p>试试调整搜索或筛选条件。</p>
      <p v-if="hasActiveNarrow" style="margin-top: 1rem">
        <button class="btn ghost" @click="clearNarrowFilters">清除筛选</button>
      </p>
    </div>

    <ShelfBookGrid
      v-else
      :books="books.filtered"
      :cover-urls="coverUrls"
      :cover-label="coverLabel"
      @open="openBook"
      @edit="openEdit"
      @remove="confirmRemove"
    />

    <ShelfEditDialog
      v-if="editing"
      v-model:title="editTitle"
      v-model:author="editAuthor"
      v-model:tags="editTags"
      @save="saveEdit"
      @cancel="editing = null"
    />
  </div>
</template>
