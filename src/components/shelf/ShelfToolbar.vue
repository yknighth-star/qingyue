<script setup lang="ts">
import type { FormatFilter, ProgressFilter, ShelfSort } from '@/types'
import { useBooksStore } from '@/stores/books'

defineProps<{
  formatOptions: { id: FormatFilter; label: string }[]
  progressOptions: { id: ProgressFilter; label: string }[]
  sortOptions: { id: ShelfSort; label: string }[]
}>()

const books = useBooksStore()
</script>

<template>
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
</template>
