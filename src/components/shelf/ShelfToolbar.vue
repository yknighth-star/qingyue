<script setup lang="ts">
import type { FormatFilter, ProgressFilter, ShelfSort } from '@/types'
import { useBooksStore } from '@/stores/books'

defineProps<{
  formatOptions: { id: FormatFilter; label: string }[]
  progressOptions: { id: ProgressFilter; label: string }[]
  sortOptions: { id: ShelfSort; label: string }[]
  /** When true, always show (e.g. inside mobile search sheet). */
  forceShow?: boolean
}>()

const books = useBooksStore()
</script>

<template>
  <div
    v-if="books.books.length"
    class="shelf-toolbar"
    :class="{ 'shelf-toolbar-force': forceShow }"
  >
    <div class="shelf-toolbar-row">
      <input
        v-model="books.searchQuery"
        class="shelf-search"
        type="search"
        placeholder="搜索书名、作者"
        autocomplete="off"
      />
      <div class="shelf-sort">
        <select v-model="books.sortBy" aria-label="排序">
          <option v-for="s in sortOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>
      <span class="shelf-count">{{ books.filtered.length }} / {{ books.books.length }}</span>
    </div>
    <div class="shelf-filter-groups">
      <div class="shelf-chips" role="group" aria-label="格式">
        <button
          v-for="f in formatOptions"
          :key="f.id"
          class="chip"
          :class="{ active: books.formatFilter === f.id }"
          @click="books.formatFilter = f.id"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="shelf-chips" role="group" aria-label="进度">
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
</template>
