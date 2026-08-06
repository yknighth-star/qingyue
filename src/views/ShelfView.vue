<script setup lang="ts">
import type { FormatFilter, ProgressFilter, ShelfSort } from '@/types'
import { useShelfActions, useShelfLifecycle } from '@/composables/useShelfActions'
import ShelfToolbar from '@/components/shelf/ShelfToolbar.vue'
import ShelfBookGrid from '@/components/shelf/ShelfBookGrid.vue'
import ShelfEditDialog from '@/components/shelf/ShelfEditDialog.vue'

const formatOptions: { id: FormatFilter; label: string }[] = [
  { id: 'all', label: '全部格式' },
  { id: 'epub', label: 'EPUB' },
  { id: 'txt', label: 'TXT' },
  { id: 'pdf', label: 'PDF' },
]

const progressOptions: { id: ProgressFilter; label: string }[] = [
  { id: 'all', label: '全部进度' },
  { id: 'unread', label: '未读' },
  { id: 'reading', label: '在读' },
  { id: 'done', label: '读完' },
]

const sortOptions: { id: ShelfSort; label: string }[] = [
  { id: 'activity', label: '最近阅读' },
  { id: 'added', label: '最近添加' },
  { id: 'title', label: '标题' },
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
</script>

<template>
  <div
    class="app-shell"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop="onDrop"
  >
    <header class="topbar" @mousedown="clearUiSelection">
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
      <span v-if="stats.stats.totalMinutes" class="stats-chip">
        阅读 {{ Math.round(stats.stats.totalMinutes) }} 分钟 · 连续 {{ stats.stats.streakDays }} 天
      </span>
      <button class="btn" @click="fileInput?.click()">导入文件</button>
      <button class="btn ghost" title="清理内容相同的重复文件" @click="onDedup">清理重复</button>
      <button class="btn danger" title="删除全部文件、进度与笔记" @click="onClearLibrary">
        清空文库
      </button>
      <button v-if="books.fsSupported" class="btn primary" @click="onLinkFolder">
        {{ books.fsLinkedName ? `文件夹: ${books.fsLinkedName}` : '关联文件夹' }}
      </button>
      <button v-if="books.fsLinkedName" class="btn ghost" @click="onRescan">扫描</button>
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
    <div v-if="dragging" class="warn">松开以导入文件…</div>

    <ShelfToolbar
      :format-options="formatOptions"
      :progress-options="progressOptions"
      :sort-options="sortOptions"
    />

    <div v-if="!books.books.length" class="empty">
      <h2>还没有文件</h2>
      <p>
        导入 EPUB / TXT / PDF 等文档，或在桌面 Chrome/Edge 关联同级目录
        <code>E:\Projects\Books</code>。
      </p>
      <p style="margin-top: 1rem">
        <button class="btn primary" @click="fileInput?.click()">选择文件</button>
      </p>
    </div>

    <div v-else-if="!books.filtered.length" class="empty">
      <h2>没有匹配的文件</h2>
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
