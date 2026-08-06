import type { PageTurnMode } from '@/types'
import { playCurlIn, playCurlOut } from '@/utils/pageCurl'

/** Shared curl animation gate for TXT / PDF / EPUB page turns. */
export function createCurlGate() {
  let curling = false

  async function run(
    pageTurn: PageTurnMode,
    container: HTMLElement | null | undefined,
    dir: 'next' | 'prev',
    action: () => void | Promise<void>,
  ): Promise<void> {
    if (pageTurn !== 'curl') {
      await action()
      return
    }
    if (curling) return
    curling = true
    try {
      await playCurlOut(container ?? null, dir)
      await action()
      await playCurlIn(container ?? null, dir)
    } finally {
      curling = false
    }
  }

  return { run }
}
