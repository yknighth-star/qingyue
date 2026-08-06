<script setup lang="ts">
import type { BookRecord } from '@/types'

defineProps<{
  open: boolean
  book: BookRecord | null
  totalMinutes: number
  desktopUi: boolean
}>()

const emit = defineEmits<{
  close: []
  delete: []
}>()
</script>

<template>
  <aside class="panel" :class="{ open }">
    <div class="panel-header">
      <strong>更多</strong>
      <button class="btn ghost" @click="emit('close')">关闭</button>
    </div>
    <div class="panel-body">
      <p>格式：{{ book?.format }} · 存储：{{ book?.storage }}</p>
      <p v-if="book?.fsPath">路径：{{ book.fsPath }}</p>
      <p>阅读统计：累计 {{ Math.round(totalMinutes) }} 分钟</p>
      <p style="color: var(--muted); font-size: 0.85rem">
        快捷键：←/→/空格/PgUp/PgDn 翻页 · Home/End 首尾 · T 目录 · B 书签 · F 全屏 · / 搜索
        <br />
        顶栏 Aa 排版 · ⋯ 更多；底栏 ▶ 听书、▾ 朗读设置；选区可「读选中」。
        <br />
        笔记：拖选文字后点颜色保存；点空白可显隐菜单。
        <template v-if="desktopUi"> · 滚轮翻页 · 点进度条跳转</template>
      </p>
      <button
        class="btn danger"
        style="margin-top: 0.75rem; display: block; width: 100%"
        @click="emit('delete')"
      >
        删除此文件
      </button>
    </div>
  </aside>
</template>
