import type { Ref } from 'vue'
import type { ReaderEngine } from '@/engines/types'
import type { ContentGestureEvent, ContentTapEvent } from '@/engines/types'
import type { BookRecord, PageTurnMode } from '@/types'
import type { ReaderPanel } from './useReaderChrome'
import type { TurnProfile } from '@/utils/turnProfile'

export function useReaderGestures(opts: {
  engine: Ref<ReaderEngine | null>
  book: Ref<BookRecord | null>
  panel: Ref<ReaderPanel>
  stageRef: Ref<HTMLElement | null>
  pageTurn: () => PageTurnMode
  turnProfile: () => TurnProfile
  shouldBlockTapActions: () => boolean
  hasTextSelection: () => boolean
  /** 划线模式：长按进入后禁止翻页，直到关闭 */
  markMode: Ref<boolean>
  selectionBar: Ref<unknown>
  getIgnoreTapUntil: () => number
  clearSelectionBar: () => void
  onMarkBodyDown: (clientX: number, clientY: number) => boolean
  onMarkBodyMove: (clientX: number, clientY: number) => void
  onMarkBodyUp: () => void
  onLongPress: () => void
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
  let longPressTimer: number | null = null
  const LONG_PRESS_MS = 320

  function clearLongPressTimer() {
    if (longPressTimer != null) {
      window.clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

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

  function inMarkMode() {
    return opts.markMode.value
  }

  function turnByDelta(deltaY: number) {
    if (!opts.engine.value) return
    if (opts.panel.value !== 'none') {
      opts.closePanel()
      return
    }
    if (opts.shouldBlockTapActions() || inMarkMode()) return
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
    if (opts.panel.value !== 'none') {
      opts.closePanel()
      return
    }
    if (opts.shouldBlockTapActions() || inMarkMode()) return
    if (isScrollMode()) return
    if (dir === 'prev') void opts.engine.value?.prev()
    else void opts.engine.value?.next()
  }

  function edgeFrac() {
    return opts.turnProfile().edgeWidth
  }

  function dismissMarkOrChrome() {
    // 划线模式只能点「关闭」退出；点空白不退出，便于继续改选区
    if (inMarkMode()) return true
    if (opts.selectionBar.value) {
      opts.clearSelectionBar()
      return true
    }
    return false
  }

  /** Normalize tap X to stage [0,1]; clamp so mapping noise still hits edge zones. */
  function stageTapX(clientX: number): number | null {
    const stage = opts.stageRef.value
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    const w = Math.max(1, rect.width)
    return Math.min(1, Math.max(0, (clientX - rect.left) / w))
  }

  function onStageClick(e: MouseEvent) {
    if (opts.panel.value !== 'none') {
      opts.closePanel()
      return
    }
    if (Date.now() < opts.getIgnoreTapUntil() || Date.now() < ignoreClickUntil) return
    if (dismissMarkOrChrome()) return
    if (opts.hasTextSelection()) return
    const x = stageTapX(e.clientX)
    if (x == null) return
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
    if (dismissMarkOrChrome()) return
    if (opts.hasTextSelection()) return
    const x = stageTapX(ev.clientX)
    if (x == null) {
      opts.toggleChrome()
      return
    }
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

  function clearDragPreview() {
    const stage = opts.stageRef.value
    if (!stage) return
    stage.classList.remove(
      'curl-drag',
      'curl-drag-next',
      'curl-drag-prev',
      'slide-drag',
      'slide-drag-next',
      'slide-drag-prev',
    )
    stage.style.removeProperty('--curl-drag')
    stage.style.removeProperty('--slide-drag')
  }

  function applyCurlDragPreview(dir: 'next' | 'prev', progress: number) {
    if (!allowLiveCurlPreview()) return
    const stage = opts.stageRef.value
    if (!stage) return
    clearDragPreview()
    const p = Math.min(1, Math.max(0, progress))
    stage.classList.add('curl-drag', dir === 'next' ? 'curl-drag-next' : 'curl-drag-prev')
    stage.style.setProperty('--curl-drag', String(p))
  }

  function applySlideDragPreview(dir: 'next' | 'prev', progress: number) {
    if (!allowLiveSlidePreview()) return
    const stage = opts.stageRef.value
    if (!stage) return
    clearDragPreview()
    const p = Math.min(1, Math.max(0, progress))
    stage.classList.add('slide-drag', dir === 'next' ? 'slide-drag-next' : 'slide-drag-prev')
    stage.style.setProperty('--slide-drag', String(p))
  }

  function applyDragPreview(dir: 'next' | 'prev', progress: number) {
    if (opts.pageTurn() === 'curl') applyCurlDragPreview(dir, progress)
    else if (opts.pageTurn() === 'slide') applySlideDragPreview(dir, progress)
  }

  function allowLiveCurlPreview() {
    // Fine + full-curl only (turnProfile); never transform EPUB live surface
    return (
      opts.pageTurn() === 'curl' &&
      opts.turnProfile().liveCurlPreview &&
      !isEpub()
    )
  }

  function allowLiveSlidePreview() {
    // Slide follow-finger for TXT/PDF; EPUB stays ghost-only at commit
    return opts.pageTurn() === 'slide' && !isEpub()
  }

  function beginSwipe(pointerId: number, clientX: number, clientY: number) {
    if (!isPagedMode() || opts.panel.value !== 'none') return
    if (inMarkMode() || opts.shouldBlockTapActions() || opts.hasTextSelection()) return
    clearLongPressTimer()
    swipe = {
      id: pointerId,
      x0: clientX,
      y0: clientY,
      t0: Date.now(),
      dragging: false,
      lastX: clientX,
      lastY: clientY,
    }
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null
      if (swipe && swipe.id === pointerId && !swipe.dragging) {
        const x = swipe.x0
        const y = swipe.y0
        swipe = null
        clearDragPreview()
        opts.onLongPress()
        opts.onMarkBodyDown(x, y)
      }
    }, LONG_PRESS_MS)
  }

  function moveSwipe(
    pointerId: number,
    clientX: number,
    clientY: number,
    optsMove?: { prevent?: () => void; capture?: () => void },
  ) {
    if (inMarkMode()) {
      clearLongPressTimer()
      swipe = null
      clearDragPreview()
      return
    }
    if (!swipe || swipe.id !== pointerId) return
    if (opts.hasTextSelection()) {
      clearLongPressTimer()
      const x = swipe.x0
      const y = swipe.y0
      swipe = null
      clearDragPreview()
      opts.onLongPress()
      opts.onMarkBodyDown(x, y)
      opts.onMarkBodyMove(clientX, clientY)
      return
    }
    swipe.lastX = clientX
    swipe.lastY = clientY
    const dx = clientX - swipe.x0
    const dy = clientY - swipe.y0
    const held = Date.now() - swipe.t0
    if (!swipe.dragging) {
      if (held >= LONG_PRESS_MS) {
        clearLongPressTimer()
        const x = swipe.x0
        const y = swipe.y0
        swipe = null
        clearDragPreview()
        opts.onLongPress()
        opts.onMarkBodyDown(x, y)
        opts.onMarkBodyMove(clientX, clientY)
        return
      }
      if (Math.abs(dx) < 28 && Math.abs(dy) < 28) return
      if (Math.abs(dy) > Math.abs(dx) * 1.05) {
        clearLongPressTimer()
        swipe = null
        clearDragPreview()
        return
      }
      if (Math.abs(dx) < Math.abs(dy) * 1.35) {
        clearLongPressTimer()
        swipe = null
        clearDragPreview()
        return
      }
      clearLongPressTimer()
      swipe.dragging = true
      optsMove?.capture?.()
    }
    optsMove?.prevent?.()
    const w = opts.stageRef.value?.clientWidth || 320
    if (dx < 0) applyDragPreview('next', Math.min(1, -dx / (w * 0.55)))
    else applyDragPreview('prev', Math.min(1, dx / (w * 0.55)))
  }

  function endSwipe(pointerId: number, clientX?: number, clientY?: number) {
    if (!swipe || swipe.id !== pointerId) return
    clearLongPressTimer()
    const x = clientX ?? swipe.lastX
    const y = clientY ?? swipe.lastY
    const dx = x - swipe.x0
    const dy = y - swipe.y0
    const dt = Date.now() - swipe.t0
    const wasDrag = swipe.dragging
    swipe = null
    clearDragPreview()
    if (!wasDrag || !isPagedMode() || inMarkMode()) return
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
    clearLongPressTimer()
    swipe = null
    clearDragPreview()
  }

  function onStagePointerDown(e: PointerEvent) {
    if (inMarkMode()) {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.mark-handle, .selection-bar, .mark-mode-hint, .reader-chrome, .panel, button, a'))
        return
      opts.onMarkBodyDown(e.clientX, e.clientY)
      try {
        opts.stageRef.value?.setPointerCapture?.(e.pointerId)
      } catch {
        /* */
      }
      return
    }
    if (!isPagedMode() || opts.panel.value !== 'none') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (opts.shouldBlockTapActions() || opts.hasTextSelection()) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('button, a, input, textarea, .reader-chrome, .panel, .dict-popup, .selection-bar, .mark-mode-hint'))
      return
    beginSwipe(e.pointerId, e.clientX, e.clientY)
  }

  function onStagePointerMove(e: PointerEvent) {
    if (inMarkMode()) {
      opts.onMarkBodyMove(e.clientX, e.clientY)
      return
    }
    moveSwipe(e.pointerId, e.clientX, e.clientY, {
      prevent: () => e.preventDefault(),
      capture: () => {
        try {
          opts.stageRef.value?.setPointerCapture?.(e.pointerId)
        } catch {
          /* */
        }
      },
    })
  }

  function onStagePointerUp(e: PointerEvent) {
    if (inMarkMode()) {
      opts.onMarkBodyUp()
      return
    }
    endSwipe(e.pointerId, e.clientX, e.clientY)
  }

  function onStagePointerCancel(e: PointerEvent) {
    if (inMarkMode()) {
      opts.onMarkBodyUp()
      return
    }
    cancelSwipe(e.pointerId)
  }

  function onContentGesture(ev: ContentGestureEvent) {
    if (ev.phase === 'longpress') {
      cancelSwipe(ev.pointerId)
      opts.onLongPress()
      opts.onMarkBodyDown(ev.clientX, ev.clientY)
      return
    }
    if (inMarkMode()) {
      if (ev.phase === 'start') {
        opts.onMarkBodyDown(ev.clientX, ev.clientY)
        return
      }
      if (ev.phase === 'move') {
        opts.onMarkBodyMove(ev.clientX, ev.clientY)
        return
      }
      opts.onMarkBodyUp()
      cancelSwipe(ev.pointerId)
      return
    }
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
