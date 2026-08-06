<script setup lang="ts">
import { HIGHLIGHT_COLORS } from '@/types'

withDefaults(
  defineProps<{
    left: number
    top: number
    /** When false, hide color dots (engine cannot paint text highlights). */
    showHighlights?: boolean
  }>(),
  { showHighlights: true },
)

const emit = defineEmits<{
  highlight: [color: string]
  copy: []
  speak: []
  lookup: []
  close: []
}>()
</script>

<template>
  <div
    class="selection-bar"
    :style="{ left: left + 'px', top: top + 'px' }"
    @click.stop
    @pointerdown.stop
  >
    <template v-if="showHighlights">
      <button
        v-for="c in HIGHLIGHT_COLORS"
        :key="c"
        type="button"
        class="color-dot"
        :style="{ background: c }"
        title="保存高亮"
        @click.stop.prevent="emit('highlight', c)"
      />
    </template>
    <button type="button" class="btn ghost sel-action" @click.stop="emit('copy')">复制</button>
    <button type="button" class="btn ghost sel-action" @click.stop="emit('speak')">读选中</button>
    <button type="button" class="btn ghost sel-action" @click.stop="emit('lookup')">释义</button>
    <button type="button" class="btn ghost sel-action" @click.stop="emit('close')">×</button>
  </div>
</template>
