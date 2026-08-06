<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { confirmState, resolveConfirm } from '@/composables/useConfirm'

function onKey(e: KeyboardEvent) {
  if (!confirmState.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    resolveConfirm(false)
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    e.stopImmediatePropagation()
    resolveConfirm(true)
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

watch(
  () => confirmState.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="confirmState.open"
      class="confirm-backdrop"
      role="presentation"
      @click.self="resolveConfirm(false)"
    >
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="'confirm-title'"
        :aria-describedby="'confirm-message'"
      >
        <h3 id="confirm-title" class="confirm-title">{{ confirmState.title }}</h3>
        <p id="confirm-message" class="confirm-message">{{ confirmState.message }}</p>
        <div class="confirm-actions">
          <button type="button" class="btn ghost" @click="resolveConfirm(false)">
            {{ confirmState.cancelText }}
          </button>
          <button
            type="button"
            class="btn"
            :class="confirmState.danger ? 'danger' : 'primary'"
            @click="resolveConfirm(true)"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
