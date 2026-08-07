import {
  createMarkDragController,
  type MarkDragController,
  type MarkHandleRects,
} from '@/utils/markSelect'

export type MarkPhase = 'start' | 'move' | 'end'

/** Lazy MarkDragController + shared markDrag / markHandle phase dispatch. */
export function createMarkSurface(opts: {
  getDocs: () => Document[]
  getRoot?: () => HTMLElement | null
}) {
  let ctl: MarkDragController | null = null

  function get(): MarkDragController {
    if (!ctl) {
      ctl = createMarkDragController({
        getDocs: opts.getDocs,
        getRoot: opts.getRoot,
      })
    }
    return ctl
  }

  function markDrag(
    phase: MarkPhase,
    clientX: number,
    clientY: number,
  ): MarkHandleRects | null {
    const c = get()
    if (phase === 'start') {
      c.beginDrag(clientX, clientY)
      return c.getHandleRects()
    }
    if (phase === 'move') {
      c.moveDrag(clientX, clientY)
      return c.getHandleRects()
    }
    c.endDrag()
    return c.getHandleRects()
  }

  function markHandle(
    phase: MarkPhase,
    which: 'start' | 'end',
    clientX: number,
    clientY: number,
  ): MarkHandleRects | null {
    const c = get()
    if (phase === 'start') {
      c.beginHandle(which)
      return c.getHandleRects()
    }
    if (phase === 'move') {
      c.moveHandle(clientX, clientY)
      return c.getHandleRects()
    }
    c.endHandle()
    return c.getHandleRects()
  }

  function getMarkHandleRects(): MarkHandleRects | null {
    return get().getHandleRects()
  }

  function endAll() {
    ctl?.endDrag()
    ctl?.endHandle()
  }

  function reset() {
    endAll()
    ctl = null
  }

  return {
    get,
    markDrag,
    markHandle,
    getMarkHandleRects,
    endAll,
    reset,
  }
}

export type MarkSurface = ReturnType<typeof createMarkSurface>
