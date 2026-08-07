import type { Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { ContentTapEvent } from '@/engines/types'
import type { BookRecord, PageTurnMode } from '@/types'
import type { ReaderPanel } from './useReaderChrome'

export function useReaderGestures(opts: {
  engine: Ref<ReaderEngine | null>
  book: Ref<BookRecord | null>
  panel: Ref<ReaderPanel>
  stageRef: Ref<HTMLElement | null>
  pageTurn: () => PageTurnMode
  shouldBlockTapActions: () => boolean
  hasTextSelection: () => boolean
  selectionBar: Ref<unknown>
  getIgnoreTapUntil: () => number
  clearSelectionBar: () => void
  toggleChrome: () => void
  closePanel: () => void
}) {
  let wheelLockUntil = 0
  let swipe:
    | {
        id: number
        x0: number
        y0: number
        t0: number
        dragging: boolean
      }
    | null = null
  let ignoreClickUntil = 0

  function isScrollMode() {
    return opts.pageTurn() === 'scroll'
  }

  function isPagedMode() {
    const m = opts.pageTurn()
    return m === 'slide' || m === 'curl'
  }

  function turnByDelta(deltaY: number) {
    if (!opts.engine.value || opts.panel.value !== 'none') return
    if (opts.shouldBlockTapActions()) return
    // 上下滑动：滚轮交给内容区连续滚动，不整页跳
    if (isScrollMode()) return
    const now = Date.now()
    if (now < wheelLockUntil) return
    if (Math.abs(deltaY) < 8) return
    wheelLockUntil = now + 220
    if (deltaY > 0) void opts.engine.value.next()
    else void opts.engine.value.prev()
  }

  function onStageWheel(e: WheelEvent) {
    if (isScrollMode()) return
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.txt-content, .pdf-pages, .pdf-page')) return
    e.preventDefault()
    turnByDelta(e.deltaY)
  }

  function onEngineWheel(deltaY: number) {
    turnByDelta(deltaY)
  }

  function onEdgeTurn(dir: 'prev' | 'next') {
    if (opts.shouldBlockTapActions()) return
    // 上下滑动：禁用左右热区翻页（竞品同款）
    if (isScrollMode()) return
    if (dir === 'prev') void opts.engine.value?.prev()
    else void opts.engine.value?.next()
  }

  function onStageClick(e: MouseEvent) {
    if (opts.panel.value !== 'none') return
    if (Date.now() < opts.getIgnoreTapUntil() || Date.now() < ignoreClickUntil) return
    if (opts.selectionBar.value) {
      opts.clearSelectionBar()
      return
    }
    if (opts.hasTextSelection()) return
    const stage = opts.stageRef.value
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (!isScrollMode()) {
      if (x < 0.22) {
        onEdgeTurn('prev')
        return
      }
      if (x > 0.78) {
        onEdgeTurn('next')
        return
      }
    }
    opts.toggleChrome()
  }

  function onContentTap(ev: ContentTapEvent) {
    if (opts.panel.value !== 'none') {
      opts.closePanel()
      return
    }
    if (ev.isLink) return
    if (ev.hasSelection || Date.now() < opts.getIgnoreTapUntil() || Date.now() < ignoreClickUntil) return
    if (opts.selectionBar.value) {
      opts.clearSelectionBar()
      return
    }
    if (opts.hasTextSelection()) return
    const stage = opts.stageRef.value
    if (!stage) {
      opts.toggleChrome()
      return
    }
    if (!isScrollMode()) {
      const rect = stage.getBoundingClientRect()
      const x = (ev.clientX - rect.left) / Math.max(1, rect.width)
      if (x > 0 && x < 1) {
        if (x < 0.22) {
          onEdgeTurn('prev')
          return
        }
        if (x > 0.78) {
          onEdgeTurn('next')
          return
        }
      }
    }
    opts.toggleChrome()
  }

  function clearCurlDragPreview() {
    const stage = opts.stageRef.value
    if (!stage) return
    stage.classList.remove('curl-drag', 'curl-drag-next', 'curl-drag-prev')
    stage.style.removeProperty('--curl-drag')
  }

  function applyCurlDragPreview(dir: 'next' | 'prev', progress: number) {
    const stage = opts.stageRef.value
    if (!stage || opts.pageTurn() !== 'curl') return
    const p = Math.min(1, Math.max(0, progress))
    stage.classList.add('curl-drag', dir === 'next' ? 'curl-drag-next' : 'curl-drag-prev')
    stage.classList.remove(dir === 'next' ? 'curl-drag-prev' : 'curl-drag-next')
    stage.style.setProperty('--curl-drag', String(p))
  }

  function onStagePointerDown(e: PointerEvent) {
    if (!isPagedMode() || opts.panel.value !== 'none') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (opts.shouldBlockTapActions() || opts.hasTextSelection()) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('button, a, input, textarea, .reader-chrome, .panel, .dict-popup')) return
    swipe = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: Date.now(),
      dragging: false,
    }
    try {
      opts.stageRef.value?.setPointerCapture?.(e.pointerId)
    } catch {
      /* */
    }
  }

  function onStagePointerMove(e: PointerEvent) {
    if (!swipe || swipe.id !== e.pointerId) return
    const dx = e.clientX - swipe.x0
    const dy = e.clientY - swipe.y0
    if (!swipe.dragging) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
      // Prefer vertical → abort (let scroll / selection win)
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        swipe = null
        clearCurlDragPreview()
        return
      }
      swipe.dragging = true
    }
    e.preventDefault()
    if (opts.pageTurn() === 'curl') {
      const w = opts.stageRef.value?.clientWidth || 320
      if (dx < 0) applyCurlDragPreview('next', Math.min(1, -dx / (w * 0.55)))
      else applyCurlDragPreview('prev', Math.min(1, dx / (w * 0.55)))
    }
  }

  function onStagePointerUp(e: PointerEvent) {
    if (!swipe || swipe.id !== e.pointerId) return
    const dx = e.clientX - swipe.x0
    const dy = e.clientY - swipe.y0
    const dt = Date.now() - swipe.t0
    const wasDrag = swipe.dragging
    swipe = null
    clearCurlDragPreview()
    if (!wasDrag || !isPagedMode()) return
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    // Quick flick or long drag past threshold
    const w = opts.stageRef.value?.clientWidth || 320
    const enough = Math.abs(dx) > Math.min(88, w * 0.18) || (dt < 280 && Math.abs(dx) > 40)
    if (!enough) return
    ignoreClickUntil = Date.now() + 350
    if (dx < 0) void opts.engine.value?.next()
    else void opts.engine.value?.prev()
  }

  function onStagePointerCancel(e: PointerEvent) {
    if (!swipe || swipe.id !== e.pointerId) return
    swipe = null
    clearCurlDragPreview()
  }

  return {
    turnByDelta,
    onStageWheel,
    onEngineWheel,
    onEdgeTurn,
    onStageClick,
    onContentTap,
    onStagePointerDown,
    onStagePointerMove,
    onStagePointerUp,
    onStagePointerCancel,
  }
}
