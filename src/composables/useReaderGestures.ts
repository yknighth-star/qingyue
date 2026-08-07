import type { Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { ContentGestureEvent, ContentTapEvent } from '@/engines/types'
import type { BookRecord, PageTurnMode } from '@/types'
import type { ReaderPanel } from './useReaderChrome'
import { resolveTurnProfile, type TurnProfile } from '@/utils/turnProfile'

export function useReaderGestures(opts: {
  engine: Ref<ReaderEngine | null>
  book: Ref<BookRecord | null>
  panel: Ref<ReaderPanel>
  stageRef: Ref<HTMLElement | null>
  pageTurn: () => PageTurnMode
  turnProfile: () => TurnProfile
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
        lastX: number
        lastY: number
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

  function isEpub() {
    return opts.book.value?.format === 'epub'
  }

  function allowLiveCurlPreview() {
    return opts.pageTurn() === 'curl' && opts.turnProfile().liveCurlPreview && !isEpub()
  }

  function turnByDelta(deltaY: number) {
    if (!opts.engine.value || opts.panel.value !== 'none') return
    if (opts.shouldBlockTapActions()) return
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
    if (isScrollMode()) return
    if (dir === 'prev') void opts.engine.value?.prev()
    else void opts.engine.value?.next()
  }

  function edgeFrac() {
    return opts.turnProfile().edgeWidth
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
      const edge = edgeFrac()
      if (x < edge) {
        onEdgeTurn('prev')
        return
      }
      if (x > 1 - edge) {
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
      const edge = edgeFrac()
      if (x > 0 && x < 1) {
        if (x < edge) {
          onEdgeTurn('prev')
          return
        }
        if (x > 1 - edge) {
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
    if (!allowLiveCurlPreview()) return
    const stage = opts.stageRef.value
    if (!stage) return
    const p = Math.min(1, Math.max(0, progress))
    stage.classList.add('curl-drag', dir === 'next' ? 'curl-drag-next' : 'curl-drag-prev')
    stage.classList.remove(dir === 'next' ? 'curl-drag-prev' : 'curl-drag-next')
    stage.style.setProperty('--curl-drag', String(p))
  }

  function beginSwipe(pointerId: number, clientX: number, clientY: number) {
    if (!isPagedMode() || opts.panel.value !== 'none') return
    if (opts.shouldBlockTapActions() || opts.hasTextSelection()) return
    swipe = {
      id: pointerId,
      x0: clientX,
      y0: clientY,
      t0: Date.now(),
      dragging: false,
      lastX: clientX,
      lastY: clientY,
    }
  }

  function moveSwipe(pointerId: number, clientX: number, clientY: number, prevent?: () => void) {
    if (!swipe || swipe.id !== pointerId) return
    swipe.lastX = clientX
    swipe.lastY = clientY
    const dx = clientX - swipe.x0
    const dy = clientY - swipe.y0
    if (!swipe.dragging) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        swipe = null
        clearCurlDragPreview()
        return
      }
      swipe.dragging = true
    }
    prevent?.()
    if (allowLiveCurlPreview()) {
      const w = opts.stageRef.value?.clientWidth || 320
      if (dx < 0) applyCurlDragPreview('next', Math.min(1, -dx / (w * 0.55)))
      else applyCurlDragPreview('prev', Math.min(1, dx / (w * 0.55)))
    }
  }

  function endSwipe(pointerId: number, clientX?: number, clientY?: number) {
    if (!swipe || swipe.id !== pointerId) return
    const x = clientX ?? swipe.lastX
    const y = clientY ?? swipe.lastY
    const dx = x - swipe.x0
    const dy = y - swipe.y0
    const dt = Date.now() - swipe.t0
    const wasDrag = swipe.dragging
    swipe = null
    clearCurlDragPreview()
    if (!wasDrag || !isPagedMode()) return
    const profile = opts.turnProfile()
    if (Math.abs(dx) < profile.swipeMinPx || Math.abs(dx) < Math.abs(dy) * 1.2) return
    const w = opts.stageRef.value?.clientWidth || 320
    const enough =
      Math.abs(dx) > Math.min(88, w * profile.swipeWidthFactor) ||
      (dt < 280 && Math.abs(dx) > profile.swipeMinPx)
    if (!enough) return
    ignoreClickUntil = Date.now() + 350
    if (dx < 0) void opts.engine.value?.next()
    else void opts.engine.value?.prev()
  }

  function cancelSwipe(pointerId: number) {
    if (!swipe || swipe.id !== pointerId) return
    swipe = null
    clearCurlDragPreview()
  }

  function onStagePointerDown(e: PointerEvent) {
    if (!isPagedMode() || opts.panel.value !== 'none') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (opts.shouldBlockTapActions() || opts.hasTextSelection()) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('button, a, input, textarea, .reader-chrome, .panel, .dict-popup')) return
    // Edge zones: allow swipe; clicks still handled via @click on zones / stage
    beginSwipe(e.pointerId, e.clientX, e.clientY)
    try {
      opts.stageRef.value?.setPointerCapture?.(e.pointerId)
    } catch {
      /* */
    }
  }

  function onStagePointerMove(e: PointerEvent) {
    moveSwipe(e.pointerId, e.clientX, e.clientY, () => e.preventDefault())
  }

  function onStagePointerUp(e: PointerEvent) {
    endSwipe(e.pointerId, e.clientX, e.clientY)
  }

  function onStagePointerCancel(e: PointerEvent) {
    cancelSwipe(e.pointerId)
  }

  /** Gestures forwarded from EPUB (and future) content documents. */
  function onContentGesture(ev: ContentGestureEvent) {
    if (ev.phase === 'start') {
      beginSwipe(ev.pointerId, ev.clientX, ev.clientY)
      return
    }
    if (ev.phase === 'move') {
      moveSwipe(ev.pointerId, ev.clientX, ev.clientY)
      return
    }
    if (ev.phase === 'cancel') {
      cancelSwipe(ev.pointerId)
      return
    }
    endSwipe(ev.pointerId, ev.clientX, ev.clientY)
  }

  return {
    turnByDelta,
    onStageWheel,
    onEngineWheel,
    onEdgeTurn,
    onStageClick,
    onContentTap,
    onContentGesture,
    onStagePointerDown,
    onStagePointerMove,
    onStagePointerUp,
    onStagePointerCancel,
  }
}
