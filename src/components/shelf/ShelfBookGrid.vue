<script setup lang="ts">
import type { BookRecord } from '@/types'
import { formatBytes, formatPercent } from '@/utils/format'
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
</script>

<template>
  <div class="shelf-grid">
    <article
      v-for="b in books"
      :key="b.id"
      class="book-card"
      :data-format="b.format"
      :class="{ favorite: b.isFavorite, started: b.progressPercent > 0 }"
    >
      <div
        class="cover"
        role="button"
        tabindex="0"
        @click="emit('open', b.id)"
        @keydown.enter="emit('open', b.id)"
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
        <div v-if="b.progressPercent > 0" class="cover-progress">
          <span :style="{ width: formatPercent(b.progressPercent) }" />
        </div>
      </div>
      <div class="book-meta">
        <div class="book-title" :title="b.title" @click="emit('open', b.id)">{{ b.title }}</div>
        <div class="book-author">{{ b.author }}</div>
        <div class="book-foot">
          <span class="book-size">{{ formatBytes(b.fileSize) }}</span>
          <span class="book-pct">{{
            b.progressPercent > 0 ? `已读 ${formatPercent(b.progressPercent)}` : '未读'
          }}</span>
        </div>
        <div class="card-actions">
          <button class="icon-btn" title="编辑" @click="emit('edit', b)">✎</button>
          <button class="icon-btn danger" title="删除" @click="emit('remove', b)">删</button>
        </div>
      </div>
    </article>
  </div>
</template>
