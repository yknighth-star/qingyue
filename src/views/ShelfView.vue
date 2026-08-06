<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBooksStore } from '@/stores/books'
import { useStatsStore } from '@/stores/stats'
import { formatBytes, formatPercent } from '@/utils/format'
import { confirmDialog } from '@/composables/useConfirm'
import type { BookRecord, FormatFilter, ProgressFilter, ShelfFilter, ShelfSort } from '@/types'

const router = useRouter()
const books = useBooksStore()
const stats = useStatsStore()
const fileInput = ref<HTMLInputElement | null>(null)
const message = ref('')
const editing = ref<BookRecord | null>(null)
const editTitle = ref('')
const editAuthor = ref('')
const editTags = ref('')
const dragging = ref(false)

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

const hasActiveNarrow = computed(
  () =>
    !!books.searchQuery.trim() ||
    books.formatFilter !== 'all' ||
    books.progressFilter !== 'all' ||
    !!books.tagFilter,
)

const coverUrls = computed(() => {
  const map: Record<string, string> = {}
  for (const b of books.books) {
    if (b.cover) map[b.id] = URL.createObjectURL(b.cover)
  }
  return map
})

onMounted(() => {
  void books.refresh()
})

function setFilter(f: ShelfFilter) {
  books.filter = f
}

function clearNarrowFilters() {
  books.searchQuery = ''
  books.formatFilter = 'all'
  books.progressFilter = 'all'
  books.tagFilter = null
}

async function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length) return
  try {
    const results = await books.importFiles(files)
    const dup = results.filter((r) => r.duplicated).length
    const ok = results.length - dup
    message.value = `导入 ${ok} 个` + (dup ? `，跳过重复 ${dup} 个` : '')
  } catch (err) {
    message.value = err instanceof Error ? err.message : '导入失败'
  }
}

async function onLinkFolder() {
  try {
    if (!books.fsSupported) {
      message.value = '当前浏览器不支持关联文件夹，请使用桌面版 Chrome / Edge'
      return
    }
    const scanned = await books.linkFolder()
    if (!scanned) {
      // User cancelled the system folder picker
      return
    }
    const ok = scanned.filter((s) => !s.duplicated).length
    message.value = `已关联「${books.fsLinkedName}」，新增 ${ok} 个`
  } catch (err) {
    message.value = err instanceof Error ? err.message : '关联失败'
  }
}

async function onRescan() {
  const scanned = await books.rescanFolder()
  message.value = `扫描完成，新增 ${scanned.filter((s) => !s.duplicated).length} 个`
}

async function onDedup() {
  if (books.books.length < 2) {
    message.value = '文库中文件不足，无需去重'
    return
  }
  const ok = await confirmDialog({
    title: '清理重复',
    message: '将按文件内容清理重复项，保留阅读进度更高的一份。确定继续？',
    confirmText: '清理',
    danger: true,
  })
  if (!ok) return
  try {
    const { removed, groups } = await books.removeDuplicates()
    message.value =
      removed > 0 ? `已清理 ${removed} 个重复文件（${groups} 组）` : '未发现重复文件'
  } catch (err) {
    message.value = err instanceof Error ? err.message : '去重失败'
  }
}

async function onClearLibrary() {
  const n = books.books.length
  if (!n) {
    message.value = '文库已经是空的'
    return
  }
  const ok = await confirmDialog({
    title: '清空文库',
    message: `确定清空全部 ${n} 个文件？\n将删除本地缓存、阅读进度、笔记与阅读统计（不可恢复）。\n关联文件夹里的源文件不会被删除。`,
    confirmText: '清空全部',
    danger: true,
  })
  if (!ok) return
  try {
    const { removed } = await books.clearLibrary()
    await stats.reset()
    editing.value = null
    message.value = `已清空文库（${removed} 个）`
  } catch (err) {
    message.value = err instanceof Error ? err.message : '清空失败'
  }
}

function openBook(id: string) {
  void router.push({ name: 'read', params: { id } })
}

function clearUiSelection() {
  window.getSelection()?.removeAllRanges()
}

function coverLabel(title: string) {
  const t = title.trim()
  if (!t) return '书'
  return t.slice(0, 12)
}

async function confirmRemove(b: BookRecord) {
  const ok = await confirmDialog({
    title: '删除文件',
    message: `确定删除「${b.title}」？\n阅读进度与笔记也会一并删除。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await books.remove(b.id)
}

function openEdit(b: BookRecord) {
  editing.value = b
  editTitle.value = b.title
  editAuthor.value = b.author
  editTags.value = b.tags.join(', ')
}

async function saveEdit() {
  if (!editing.value) return
  await books.updateMeta(editing.value.id, {
    title: editTitle.value.trim() || editing.value.title,
    author: editAuthor.value.trim() || '未知作者',
    tags: editTags.value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
  })
  editing.value = null
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const files = [...(e.dataTransfer?.files || [])]
  if (!files.length) return
  try {
    await books.importFiles(files)
    message.value = `拖拽导入 ${files.length} 个文件`
  } catch (err) {
    message.value = err instanceof Error ? err.message : '导入失败'
  }
}
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
        <button class="tab" :class="{ active: books.filter === 'all' }" @click="setFilter('all')">全部</button>
        <button class="tab" :class="{ active: books.filter === 'favorite' }" @click="setFilter('favorite')">收藏</button>
        <button class="tab" :class="{ active: books.filter === 'recent' }" @click="setFilter('recent')">最近</button>
      </div>
      <div class="spacer" />
      <span class="stats-chip" v-if="stats.stats.totalMinutes">
        阅读 {{ Math.round(stats.stats.totalMinutes) }} 分钟 · 连续 {{ stats.stats.streakDays }} 天
      </span>
      <button class="btn" @click="fileInput?.click()">导入文件</button>
      <button class="btn ghost" title="清理内容相同的重复文件" @click="onDedup">清理重复</button>
      <button class="btn danger" title="删除全部文件、进度与笔记" @click="onClearLibrary">清空文库</button>
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

    <div v-if="books.books.length" class="shelf-toolbar">
      <div class="shelf-toolbar-row">
        <input
          v-model="books.searchQuery"
          class="shelf-search"
          type="search"
          placeholder="搜索标题或作者…"
          autocomplete="off"
        />
        <label class="shelf-sort">
          <span>排序</span>
          <select v-model="books.sortBy">
            <option v-for="s in sortOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </label>
        <span class="shelf-count">{{ books.filtered.length }} / {{ books.books.length }}</span>
      </div>
      <div class="shelf-chips">
        <button
          v-for="f in formatOptions"
          :key="f.id"
          class="chip"
          :class="{ active: books.formatFilter === f.id }"
          @click="books.formatFilter = f.id"
        >
          {{ f.label }}
        </button>
        <span class="chip-sep" aria-hidden="true" />
        <button
          v-for="p in progressOptions"
          :key="p.id"
          class="chip"
          :class="{ active: books.progressFilter === p.id }"
          @click="books.progressFilter = p.id"
        >
          {{ p.label }}
        </button>
      </div>
      <div v-if="books.allTags.length" class="shelf-chips tags">
        <button class="chip" :class="{ active: !books.tagFilter }" @click="books.tagFilter = null">
          全部标签
        </button>
        <button
          v-for="t in books.allTags"
          :key="t"
          class="chip"
          :class="{ active: books.tagFilter === t }"
          @click="books.tagFilter = t"
        >
          {{ t }}
        </button>
      </div>
    </div>

    <div v-if="!books.books.length" class="empty">
      <h2>还没有文件</h2>
      <p>导入 EPUB / TXT / PDF 等文档，或在桌面 Chrome/Edge 关联同级目录 <code>E:\Projects\Books</code>。</p>
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

    <div v-else class="shelf-grid">
      <article
        v-for="b in books.filtered"
        :key="b.id"
        class="book-card"
        :data-format="b.format"
        :class="{ favorite: b.isFavorite, started: b.progressPercent > 0 }"
      >
        <div class="cover" role="button" tabindex="0" @click="openBook(b.id)" @keydown.enter="openBook(b.id)">
          <img v-if="coverUrls[b.id]" :src="coverUrls[b.id]" :alt="b.title" />
          <div v-else class="cover-fallback">
            <span class="cover-label">{{ coverLabel(b.title) }}</span>
          </div>
          <span class="badge" :data-format="b.format">{{ b.format }}</span>
          <button
            class="fav-btn"
            :class="{ on: b.isFavorite }"
            :title="b.isFavorite ? '取消收藏' : '收藏'"
            @click.stop="books.toggleFavorite(b.id)"
          >
            {{ b.isFavorite ? '★' : '☆' }}
          </button>
          <div v-if="b.progressPercent > 0" class="cover-progress">
            <span :style="{ width: formatPercent(b.progressPercent) }" />
          </div>
        </div>
        <div class="book-meta">
          <div class="book-title" :title="b.title" @click="openBook(b.id)">{{ b.title }}</div>
          <div class="book-author">{{ b.author }}</div>
          <div class="book-foot">
            <span class="book-size">{{ formatBytes(b.fileSize) }}</span>
            <span class="book-pct">{{ b.progressPercent > 0 ? `已读 ${formatPercent(b.progressPercent)}` : '未读' }}</span>
          </div>
          <div class="card-actions">
            <button class="icon-btn" title="编辑" @click="openEdit(b)">✎</button>
            <button class="icon-btn danger" title="删除" @click="confirmRemove(b)">删</button>
          </div>
        </div>
      </article>
    </div>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <div class="modal">
        <h3>编辑文件信息</h3>
        <div class="field">
          <label>标题</label>
          <input v-model="editTitle" />
        </div>
        <div class="field">
          <label>作者</label>
          <input v-model="editAuthor" />
        </div>
        <div class="field">
          <label>标签（逗号分隔）</label>
          <input v-model="editTags" placeholder="小说, 经典" />
        </div>
        <div class="modal-actions">
          <button class="btn ghost" @click="editing = null">取消</button>
          <button class="btn primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
