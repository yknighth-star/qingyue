import type { Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { ReaderPanel } from './useReaderChrome'

export function useReaderKeyboard(opts: {
  engine: Ref<ReaderEngine | null>
  panel: Ref<ReaderPanel>
  dictResult: Ref<string | null>
  openPanel: (p: ReaderPanel) => void
  closePanel: () => void
  addBookmark: () => void | Promise<void>
}) {
  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault()
      void opts.engine.value?.next()
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      void opts.engine.value?.prev()
    } else if (e.key === 'Home') {
      e.preventDefault()
      void opts.engine.value?.goToPercent?.(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      void opts.engine.value?.goToPercent?.(100)
    } else if (e.key === 't' || e.key === 'T') opts.openPanel('toc')
    else if ((e.key === 'b' || e.key === 'B') && opts.engine.value?.capabilities.annotations !== false) {
      void opts.addBookmark()
    } else if (e.key === 'f' || e.key === 'F') {
      const el = document.documentElement
      if (!document.fullscreenElement) void el.requestFullscreen?.()
      else void document.exitFullscreen?.()
    } else if (e.key === '/' && opts.engine.value?.capabilities.search !== false) {
      e.preventDefault()
      opts.openPanel('search')
    } else if (e.key === 'Escape') {
      if (opts.panel.value !== 'none') opts.closePanel()
      else if (opts.dictResult.value) opts.dictResult.value = null
      else if (document.fullscreenElement) void document.exitFullscreen?.()
    }
  }

  return { onKey }
}
