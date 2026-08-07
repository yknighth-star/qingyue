<script setup lang="ts">
defineProps<{
  startX: number
  startY: number
  startH: number
  endX: number
  endY: number
  endH: number
}>()

const emit = defineEmits<{
  handleStart: [which: 'start' | 'end', e: PointerEvent]
  handleMove: [e: PointerEvent]
  handleEnd: [e: PointerEvent]
}>()

function onDown(which: 'start' | 'end', e: PointerEvent) {
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  } catch {
    /* */
  }
  emit('handleStart', which, e)
}
</script>

<template>
  <div class="mark-handles" aria-hidden="true">
    <!-- 起点：上方空心圆 + 向下竖线（华为阅读样式） -->
    <button
      type="button"
      class="mark-handle mark-handle-start"
      :style="{
        left: startX + 'px',
        top: startY + 'px',
        '--mark-line': Math.max(18, startH) + 'px',
      }"
      @pointerdown.stop.prevent="onDown('start', $event)"
      @pointermove.stop="emit('handleMove', $event)"
      @pointerup.stop="emit('handleEnd', $event)"
      @pointercancel.stop="emit('handleEnd', $event)"
    >
      <span class="mark-lollipop" />
    </button>
    <!-- 终点：下方空心圆 + 向上竖线 -->
    <button
      type="button"
      class="mark-handle mark-handle-end"
      :style="{
        left: endX + 'px',
        top: endY + 'px',
        '--mark-line': Math.max(18, endH) + 'px',
      }"
      @pointerdown.stop.prevent="onDown('end', $event)"
      @pointermove.stop="emit('handleMove', $event)"
      @pointerup.stop="emit('handleEnd', $event)"
      @pointercancel.stop="emit('handleEnd', $event)"
    >
      <span class="mark-lollipop" />
    </button>
  </div>
</template>
