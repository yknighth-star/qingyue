<script setup lang="ts">
defineProps<{
  title: string
  author: string
  tags: string
}>()

const emit = defineEmits<{
  'update:title': [v: string]
  'update:author': [v: string]
  'update:tags': [v: string]
  save: []
  cancel: []
}>()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal">
      <h3>编辑信息</h3>
      <div class="field">
        <label>标题</label>
        <input :value="title" @input="emit('update:title', ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="field">
        <label>作者（可选）</label>
        <input
          :value="author"
          placeholder="佚名"
          @input="emit('update:author', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="field">
        <label>标签（逗号分隔）</label>
        <input
          :value="tags"
          placeholder="小说, 经典"
          @input="emit('update:tags', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="emit('cancel')">取消</button>
        <button class="btn primary" @click="emit('save')">保存</button>
      </div>
    </div>
  </div>
</template>
