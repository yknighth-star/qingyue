<script setup lang="ts">
import { computed } from 'vue'
import { HIGHLIGHT_COLORS } from '@/types'

const props = withDefaults(
  defineProps<{
    left: number
    top: number
    /** When false, hide color dots (engine cannot paint text highlights). */
    showHighlights?: boolean
    /** 当前选中的划线颜色（来自设置，可切换） */
    selectedColor?: string
  }>(),
  { showHighlights: true, selectedColor: HIGHLIGHT_COLORS[0] },
)

const emit = defineEmits<{
  /** 仅切换当前色，不保存 */
  selectColor: [color: string]
  /** 用当前色保存划线 */
  highlight: []
  copy: []
  speak: []
  lookup: []
  close: []
}>()

const activeColor = computed(() => {
  const c = props.selectedColor
  if (c && HIGHLIGHT_COLORS.includes(c)) return c
  return HIGHLIGHT_COLORS[0]
})
</script>

<template>
  <div
    class="selection-bar"
    :style="{ left: left + 'px', top: top + 'px' }"
    @click.stop
    @pointerdown.stop
  >
    <div class="sel-actions">
      <button type="button" class="sel-item" @click.stop="emit('copy')">
        <span class="sel-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </span>
        <span class="sel-label">复制</span>
      </button>
      <button
        v-if="showHighlights"
        type="button"
        class="sel-item"
        title="用当前颜色划线"
        @click.stop="emit('highlight')"
      >
        <span class="sel-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M4 19h16" />
            <path d="M7 15l3.2-9.5a1 1 0 0 1 1.9 0L15.3 15" />
            <path d="M8.2 12h6.6" />
          </svg>
        </span>
        <span class="sel-label">划线</span>
        <span class="sel-color-bar" :style="{ background: activeColor }" aria-hidden="true" />
      </button>
      <button type="button" class="sel-item" @click.stop="emit('speak')">
        <span class="sel-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M4 10v4h3l5 4V6l-5 4H4z" />
            <path d="M16 9.5a3.5 3.5 0 0 1 0 5" />
            <path d="M18.2 7a6.5 6.5 0 0 1 0 10" />
          </svg>
        </span>
        <span class="sel-label">朗读</span>
      </button>
      <button type="button" class="sel-item" @click.stop="emit('lookup')">
        <span class="sel-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M5 5.5C5 4.1 6.1 3 7.5 3H12v16H8a2 2 0 0 0-2 2" />
            <path d="M19 5.5C19 4.1 17.9 3 16.5 3H12v16h4a2 2 0 0 1 2 2" />
          </svg>
        </span>
        <span class="sel-label">释义</span>
      </button>
      <button type="button" class="sel-item sel-close" title="关闭" @click.stop="emit('close')">
        <span class="sel-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </span>
        <span class="sel-label">关闭</span>
      </button>
    </div>
    <div v-if="showHighlights" class="sel-colors" role="group" aria-label="选择划线颜色">
      <button
        v-for="c in HIGHLIGHT_COLORS"
        :key="c"
        type="button"
        class="color-dot"
        :class="{ active: c === activeColor }"
        :style="{ background: c }"
        :title="c === activeColor ? '当前颜色' : '切换颜色'"
        :aria-pressed="c === activeColor"
        @click.stop.prevent="emit('selectColor', c)"
      />
    </div>
    <span class="sel-caret" aria-hidden="true" />
  </div>
</template>
