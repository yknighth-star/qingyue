import type { ClipboardApi } from '../types'

export function createWebClipboard(): ClipboardApi {
  return {
    async writeText(text: string): Promise<boolean> {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
  }
}
