import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getPlatform } from '@/platform'
import { annotationsRepo, booksRepo, progressRepo } from '@/repos'
import type {
  AnnotationRecord,
  BookRecord,
  FormatFilter,
  ProgressFilter,
  ProgressRecord,
  ShelfFilter,
  ShelfSort,
} from '@/types'

export const useBooksStore = defineStore('books', () => {
  const platform = getPlatform()
  const books = ref<BookRecord[]>([])
  const filter = ref<ShelfFilter>('all')
  const tagFilter = ref<string | null>(null)
  const searchQuery = ref('')
  const formatFilter = ref<FormatFilter>('all')
  const progressFilter = ref<ProgressFilter>('all')
  const sortBy = ref<ShelfSort>('activity')
  const loading = ref(false)
  const fsLinkedName = ref<string | null>(null)
  const fsSupported = platform.env.canLinkFolder
  const quotaWarning = ref<string | null>(null)

  const allTags = computed(() => {
    const set = new Set<string>()
    books.value.forEach((b) => b.tags.forEach((t) => set.add(t)))
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
  })

  const filtered = computed(() => {
    let list = [...books.value]

    if (filter.value === 'favorite') list = list.filter((b) => b.isFavorite)
    if (filter.value === 'recent') list = list.filter((b) => b.lastReadAt)

    if (formatFilter.value !== 'all') {
      list = list.filter((b) => b.format === formatFilter.value)
    }

    if (progressFilter.value === 'unread') {
      list = list.filter((b) => (b.progressPercent || 0) <= 0)
    } else if (progressFilter.value === 'reading') {
      list = list.filter((b) => {
        const p = b.progressPercent || 0
        return p > 0 && p < 99
      })
    } else if (progressFilter.value === 'done') {
      list = list.filter((b) => (b.progressPercent || 0) >= 99)
    }

    if (tagFilter.value) list = list.filter((b) => b.tags.includes(tagFilter.value!))

    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q),
      )
    }

    list.sort((a, b) => {
      switch (sortBy.value) {
        case 'added':
          return b.addedAt - a.addedAt
        case 'title':
          return a.title.localeCompare(b.title, 'zh')
        case 'author':
          return a.author.localeCompare(b.author, 'zh') || a.title.localeCompare(b.title, 'zh')
        case 'activity':
        default:
          return (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
      }
    })

    return list
  })

  async function refresh() {
    loading.value = true
    try {
      books.value = await booksRepo.list()
      const root = await platform.files.getLinkedRoot()
      fsLinkedName.value = root?.name ?? null
      await checkQuota()
    } finally {
      loading.value = false
    }
  }

  async function checkQuota() {
    try {
      const est = await platform.files.estimateQuota()
      if (!est) {
        quotaWarning.value = null
        return
      }
      const ratio = est.usage / est.quota
      if (ratio > 0.8) {
        quotaWarning.value = platform.env.canLinkFolder
          ? `本地存储已使用约 ${Math.round(ratio * 100)}%。大文件请改用「关联文件夹」。`
          : `本地存储已使用约 ${Math.round(ratio * 100)}%。`
      } else {
        quotaWarning.value = null
      }
    } catch {
      quotaWarning.value = null
    }
  }

  async function importFiles(files: File[]) {
    const results = await platform.files.importFiles(files)
    await refresh()
    return results
  }

  async function linkFolder() {
    const info = await platform.files.linkFolder()
    if (!info) return null
    fsLinkedName.value = info.name
    const scanned = await platform.files.scanLinkedFolder()
    await refresh()
    return scanned
  }

  async function rescanFolder() {
    const scanned = await platform.files.scanLinkedFolder()
    await refresh()
    return scanned
  }

  async function toggleFavorite(id: string) {
    const book = books.value.find((b) => b.id === id)
    if (!book) return
    await booksRepo.update(id, { isFavorite: !book.isFavorite })
    await refresh()
  }

  async function updateMeta(id: string, patch: Partial<Pick<BookRecord, 'title' | 'author' | 'tags'>>) {
    await booksRepo.update(id, patch)
    await refresh()
  }

  async function remove(id: string) {
    await booksRepo.delete(id)
    await refresh()
  }

  /**
   * Deduplicate shelf books.
   * Primary key: contentHash; fallback: format + fileSize + normalized title.
   * Keeps the copy with higher progress / favorite / more recent read.
   */
  async function removeDuplicates(): Promise<{ removed: number; groups: number }> {
    const list = await booksRepo.list()
    const groups = new Map<string, BookRecord[]>()

    const keyOf = (b: BookRecord) => {
      if (b.contentHash) return `hash:${b.contentHash}`
      return `meta:${b.format}|${b.fileSize}|${b.title.trim().toLowerCase()}|${b.author.trim().toLowerCase()}`
    }

    for (const b of list) {
      const k = keyOf(b)
      const arr = groups.get(k) || []
      arr.push(b)
      groups.set(k, arr)
    }

    const score = (b: BookRecord) =>
      (b.isFavorite ? 10_000 : 0) + (b.progressPercent || 0) * 10 + (b.lastReadAt ? 1 : 0)

    let removed = 0
    let dupGroups = 0

    for (const [, members] of groups) {
      if (members.length < 2) continue
      dupGroups++
      const sorted = [...members].sort((a, b) => {
        const ds = score(b) - score(a)
        if (ds) return ds
        return (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)
      })
      const keeper = sorted[0]
      const drop = sorted.slice(1)

      let keeperHasAnnots = (await annotationsRepo.countByBook(keeper.id)) > 0
      for (const d of drop) {
        if (!keeperHasAnnots) {
          const annots = await annotationsRepo.listByBookRaw(d.id)
          for (const a of annots) {
            await annotationsRepo.put({
              ...a,
              id: `${a.id}_m_${keeper.id.slice(-4)}`,
              bookId: keeper.id,
            })
          }
          if (annots.length) keeperHasAnnots = true
        }
        const dProg = await progressRepo.get(d.id)
        const kProg = await progressRepo.get(keeper.id)
        if (dProg && (!kProg || dProg.percent > (kProg.percent || 0))) {
          await progressRepo.put({ ...dProg, bookId: keeper.id })
          await booksRepo.update(keeper.id, {
            progressPercent: dProg.percent,
            lastReadAt: Math.max(keeper.lastReadAt || 0, d.lastReadAt || 0) || dProg.updatedAt,
          })
        }
        await booksRepo.delete(d.id)
        removed++
      }
    }

    await refresh()
    return { removed, groups: dupGroups }
  }

  /** Wipe all books, blobs, progress and notes. Keeps settings / folder link. */
  async function clearLibrary(): Promise<{ removed: number }> {
    const ids = (await booksRepo.list()).map((b) => b.id)
    const count = ids.length

    books.value = []
    tagFilter.value = null
    searchQuery.value = ''
    formatFilter.value = 'all'
    progressFilter.value = 'all'

    for (const id of ids) {
      try {
        await booksRepo.delete(id)
      } catch {
        /* continue */
      }
    }

    await booksRepo.clearMetaTables()
    await refresh()
    const left = await booksRepo.count()
    if (left > 0) {
      throw new Error(`清空未完成，仍有 ${left} 本残留，请刷新页面后重试`)
    }
    return { removed: count }
  }

  async function getBlob(id: string) {
    return booksRepo.getBlob(id)
  }

  async function saveProgress(bookId: string, locator: ProgressRecord['locator'], percent: number) {
    const { updatedAt } = await progressRepo.save(bookId, locator, percent)
    const b = books.value.find((x) => x.id === bookId)
    if (b) {
      b.progressPercent = percent
      b.lastReadAt = updatedAt
      b.updatedAt = updatedAt
    }
  }

  async function getProgress(bookId: string) {
    return progressRepo.get(bookId)
  }

  async function listAnnotations(bookId: string) {
    return annotationsRepo.listByBook(bookId)
  }

  async function addAnnotation(annot: AnnotationRecord) {
    await annotationsRepo.add(annot)
  }

  async function removeAnnotation(id: string) {
    await annotationsRepo.remove(id)
  }

  return {
    books,
    filter,
    tagFilter,
    searchQuery,
    formatFilter,
    progressFilter,
    sortBy,
    loading,
    fsLinkedName,
    fsSupported,
    quotaWarning,
    allTags,
    filtered,
    refresh,
    importFiles,
    linkFolder,
    rescanFolder,
    toggleFavorite,
    updateMeta,
    remove,
    removeDuplicates,
    clearLibrary,
    getBlob,
    saveProgress,
    getProgress,
    listAnnotations,
    addAnnotation,
    removeAnnotation,
  }
})
