<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { FormatFilter, ProgressFilter, ShelfSort } from '@/types'
import { useBooksStore } from '@/stores/books'

const props = defineProps<{
  formatOptions: { id: FormatFilter; label: string }[]
  progressOptions: { id: ProgressFilter; label: string }[]
  sortOptions: { id: ShelfSort; label: string }[]
  hasActiveNarrow: boolean
}>()

const emit = defineEmits<{
  close: []
  clear: []
}>()

const books = useBooksStore()
const searchInput = ref<HTMLInputElement | null>(null)
const filtersOpen = ref(false)

const filterActive = computed(
  () =>
    books.formatFilter !== 'all' ||
    books.progressFilter !== 'all' ||
    !!books.tagFilter,
)

const sortLabel = computed(
  () => props.sortOptions.find((s) => s.id === books.sortBy)?.label ?? '排序',
)

async function focusSearch() {
  await nextTick()
  searchInput.value?.focus()
  window.setTimeout(() => searchInput.value?.focus(), 40)
}

onMounted(() => {
  void focusSearch()
  if (filterActive.value) filtersOpen.value = true
})

watch(filterActive, (on) => {
  if (on) filtersOpen.value = true
})

function toggleFilters() {
  filtersOpen.value = !filtersOpen.value
}
</script>

<template>
  <div class="shelf-search-sheet" role="dialog" aria-label="搜索" @keydown.escape="emit('close')">
    <div class="shelf-search-sheet-body">
      <div class="shelf-search-row">
        <input
          ref="searchInput"
          v-model="books.searchQuery"
          class="shelf-search-field"
          type="search"
          placeholder="搜索书名、作者"
          autocomplete="off"
          enterkeyhint="search"
          aria-label="搜索书名、作者"
        />
        <button type="button" class="btn ghost shelf-search-close" aria-label="关闭搜索" @click="emit('close')">
          关闭
        </button>
      </div>

      <div class="shelf-search-meta">
        <span class="shelf-search-result-count">{{ books.filtered.length }} / {{ books.books.length }} 本</span>
        <div class="shelf-search-actions">
          <button
            type="button"
            class="shelf-search-action"
            :class="{ active: filtersOpen || filterActive }"
            @click="toggleFilters"
          >
            筛选
            <span v-if="filterActive" class="shelf-search-action-dot" aria-hidden="true" />
          </button>
          <div class="shelf-search-sort">
            <select v-model="books.sortBy" :aria-label="`排序：${sortLabel}`">
              <option v-for="s in sortOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="filtersOpen" class="shelf-search-filters">
        <div class="shelf-chips shelf-chips-scroll" role="group" aria-label="格式">
          <button
            v-for="f in formatOptions"
            :key="f.id"
            type="button"
            class="chip"
            :class="{ active: books.formatFilter === f.id }"
            @click="books.formatFilter = f.id"
          >
            {{ f.label }}
          </button>
        </div>
        <div class="shelf-chips shelf-chips-scroll" role="group" aria-label="进度">
          <button
            v-for="p in progressOptions"
            :key="p.id"
            type="button"
            class="chip"
            :class="{ active: books.progressFilter === p.id }"
            @click="books.progressFilter = p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <div v-if="books.allTags.length" class="shelf-chips shelf-chips-scroll tags" role="group" aria-label="标签">
          <button
            type="button"
            class="chip"
            :class="{ active: !books.tagFilter }"
            @click="books.tagFilter = null"
          >
            全部标签
          </button>
          <button
            v-for="t in books.allTags"
            :key="t"
            type="button"
            class="chip"
            :class="{ active: books.tagFilter === t }"
            @click="books.tagFilter = t"
          >
            {{ t }}
          </button>
        </div>
      </div>

      <p v-if="hasActiveNarrow" class="shelf-search-sheet-hint">
        <button type="button" class="btn ghost" @click="emit('clear')">清除</button>
      </p>
    </div>
  </div>
</template>
