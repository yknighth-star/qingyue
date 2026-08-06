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

  function turnByDelta(deltaY: number) {
    if (!opts.engine.value || opts.panel.value !== 'none') return
    if (opts.shouldBlockTapActions()) return
    if (opts.pageTurn() === 'scroll' && opts.book.value?.format !== 'epub') return
    const now = Date.now()
    if (now < wheelLockUntil) return
    if (Math.abs(deltaY) < 8) return
    wheelLockUntil = now + 220
    if (deltaY > 0) void opts.engine.value.next()
    else void opts.engine.value.prev()
  }

  function onStageWheel(e: WheelEvent) {
    if (opts.pageTurn() === 'scroll') return
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
    if (dir === 'prev') void opts.engine.value?.prev()
    else void opts.engine.value?.next()
  }

  function onStageClick(e: MouseEvent) {
    if (opts.panel.value !== 'none') return
    if (Date.now() < opts.getIgnoreTapUntil()) return
    if (opts.selectionBar.value) {
      opts.clearSelectionBar()
      return
    }
    if (opts.hasTextSelection()) return
    const stage = opts.stageRef.value
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (x < 0.22) {
      onEdgeTurn('prev')
      return
    }
    if (x > 0.78) {
      onEdgeTurn('next')
      return
    }
    opts.toggleChrome()
  }

  function onContentTap(ev: ContentTapEvent) {
    if (opts.panel.value !== 'none') {
      opts.closePanel()
      return
    }
    if (ev.isLink) return
    if (ev.hasSelection || Date.now() < opts.getIgnoreTapUntil()) return
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
    opts.toggleChrome()
  }

  return {
    turnByDelta,
    onStageWheel,
    onEngineWheel,
    onEdgeTurn,
    onStageClick,
    onContentTap,
  }
}
