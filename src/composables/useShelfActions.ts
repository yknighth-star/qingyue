import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBooksStore } from '@/stores/books'
import { useStatsStore } from '@/stores/stats'
import { confirmDialog } from '@/composables/useConfirm'
import { booksRepo } from '@/repos'
import { db } from '@/db'
import { extractCoverAndMeta } from '@/storage/meta'
import { normalizeAuthor } from '@/utils/author'
import { isPlaceholderTitle, pickBookTitle } from '@/utils/bookMeta'
import type { BookRecord } from '@/types'

export function useShelfActions() {
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
  const coverUrls = ref<Record<string, string>>({})
  let coverBackfillGen = 0

  const hasActiveNarrow = computed(
    () =>
      !!books.searchQuery.trim() ||
      books.formatFilter !== 'all' ||
      books.progressFilter !== 'all' ||
      !!books.tagFilter,
  )

  function revokeCovers() {
    Object.values(coverUrls.value).forEach((u) => URL.revokeObjectURL(u))
    coverUrls.value = {}
  }

  function rebuildCovers() {
    revokeCovers()
    const map: Record<string, string> = {}
    for (const b of books.books) {
      if (b.cover) map[b.id] = URL.createObjectURL(b.cover)
    }
    coverUrls.value = map
  }

  function flash(msg: string) {
    message.value = msg
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
      flash(`已导入 ${ok} 本` + (dup ? `，跳过重复 ${dup} 本` : ''))
      rebuildCovers()
    } catch (err) {
      flash(err instanceof Error ? err.message : '导入失败')
    }
  }

  async function onLinkFolder() {
    try {
      if (!books.fsSupported) {
        flash('当前浏览器不支持关联目录，请使用桌面版 Chrome / Edge')
        return
      }
      const scanned = await books.linkFolder()
      if (!scanned) return
      const ok = scanned.filter((s) => !s.duplicated).length
      flash(`已关联「${books.fsLinkedName}」，新增 ${ok} 本`)
      rebuildCovers()
    } catch (err) {
      flash(err instanceof Error ? err.message : '关联失败')
    }
  }

  async function onRescan() {
    const scanned = await books.rescanFolder()
    flash(`同步完成，新增 ${scanned.filter((s) => !s.duplicated).length} 本`)
    rebuildCovers()
  }

  async function onDedup() {
    if (books.books.length < 2) {
      flash('书架书籍不足，无需去重')
      return
    }
    const ok = await confirmDialog({
      title: '去除重复',
      message: '将按内容去除重复书籍，保留阅读进度更高的一本。确定继续？',
      confirmText: '去除重复',
      danger: true,
    })
    if (!ok) return
    try {
      const { removed, groups } = await books.removeDuplicates()
      flash(removed > 0 ? `已去除 ${removed} 本重复（${groups} 组）` : '未发现重复书籍')
      rebuildCovers()
    } catch (err) {
      flash(err instanceof Error ? err.message : '去重失败')
    }
  }

  async function onClearLibrary() {
    const n = books.books.length
    if (!n) {
      flash('书架已经是空的')
      return
    }
    const ok = await confirmDialog({
      title: '清空书架',
      message: `确定清空全部 ${n} 本书？\n将删除本地缓存、阅读进度、笔记与阅读统计（不可恢复）。\n关联目录里的源文件不会被删除。`,
      confirmText: '仍然清空',
      danger: true,
    })
    if (!ok) return
    try {
      const { removed } = await books.clearLibrary()
      await stats.reset()
      editing.value = null
      flash(`已清空书架（${removed} 本）`)
      rebuildCovers()
    } catch (err) {
      flash(err instanceof Error ? err.message : '清空失败')
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
      title: '删除这本书',
      message: `确定删除「${b.title}」？\n阅读进度与笔记也会一并删除。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await books.remove(b.id)
    rebuildCovers()
  }

  function openEdit(b: BookRecord) {
    editing.value = b
    editTitle.value = b.title
    editAuthor.value = normalizeAuthor(b.author)
    editTags.value = b.tags.join(', ')
  }

  async function saveEdit() {
    if (!editing.value) return
    await books.updateMeta(editing.value.id, {
      title: editTitle.value.trim() || editing.value.title,
      author: normalizeAuthor(editAuthor.value),
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
      flash(`已拖入 ${files.length} 本`)
      rebuildCovers()
    } catch (err) {
      flash(err instanceof Error ? err.message : '导入失败')
    }
  }

  async function sourceFileName(b: BookRecord): Promise<string> {
    if (b.fsPath) return b.fsPath.split('/').pop() || b.fsPath
    const row = await db.bookFiles.get(b.id)
    return row?.name || `${b.title}.pdf`
  }

  /** Repair placeholder titles / junk authors from older imports (no re-parse needed). */
  async function repairJunkMeta(gen: number) {
    let updated = 0
    for (const b of books.books) {
      if (gen !== coverBackfillGen) return
      const nextAuthor = normalizeAuthor(b.author)
      const authorDirty = nextAuthor !== (b.author || '').trim()
      const titleDirty = isPlaceholderTitle(b.title)
      if (!authorDirty && !titleDirty) continue
      const patch: Partial<BookRecord> = {}
      if (authorDirty) patch.author = nextAuthor
      if (titleDirty) {
        const name = await sourceFileName(b)
        patch.title = pickBookTitle(undefined, name)
      }
      await booksRepo.update(b.id, patch)
      Object.assign(b, patch)
      updated++
    }
    if (updated && gen === coverBackfillGen) await books.refresh()
  }

  /** Fill covers for books imported before extractors improved (idle, one at a time). */
  async function backfillMissingCovers(gen: number) {
    const missing = books.books.filter((b) => !b.cover)
    if (!missing.length) return
    let updated = 0
    for (const b of missing) {
      if (gen !== coverBackfillGen) return
      try {
        const blob = await booksRepo.getBlob(b.id)
        if (!blob) continue
        const meta = await extractCoverAndMeta(blob, b.format)
        if (!meta.cover) continue
        await booksRepo.update(b.id, { cover: meta.cover })
        b.cover = meta.cover
        updated++
        if (updated % 2 === 0) rebuildCovers()
      } catch (err) {
        console.warn('Cover backfill failed', b.id, err)
      }
      await new Promise((r) => setTimeout(r, 0))
    }
    if (updated && gen === coverBackfillGen) {
      await books.refresh()
      rebuildCovers()
    }
  }

  function mount() {
    const gen = ++coverBackfillGen
    void books.refresh().then(() => {
      rebuildCovers()
      const schedule =
        typeof window.requestIdleCallback === 'function'
          ? (cb: () => void) => window.requestIdleCallback(() => cb(), { timeout: 4000 })
          : (cb: () => void) => window.setTimeout(cb, 800)
      schedule(() => {
        void repairJunkMeta(gen).then(() => backfillMissingCovers(gen))
      })
    })
    const warm =
      typeof window.requestIdleCallback === 'function'
        ? (cb: () => void) => window.requestIdleCallback(() => cb(), { timeout: 2500 })
        : (cb: () => void) => window.setTimeout(cb, 600)
    warm(() => {
      void import('@/views/ReaderView.vue')
      void import('@/engines/pdfEngine')
      void import('@/engines/epubEngine')
      void import('@/engines/txtEngine')
    })
  }

  function unmount() {
    coverBackfillGen++
    revokeCovers()
  }

  return {
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
    setFilter: (f: 'all' | 'favorite' | 'recent') => {
      books.filter = f
    },
  }
}

/** Convenience lifecycle wrapper for views */
export function useShelfLifecycle(actions: { mount: () => void; unmount: () => void }) {
  onMounted(() => actions.mount())
  onUnmounted(() => actions.unmount())
}
