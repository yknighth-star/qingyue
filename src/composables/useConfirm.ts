import { reactive } from 'vue'

export type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  /** Emphasize destructive action */
  danger?: boolean
}

type ConfirmState = {
  open: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

let resolver: ((ok: boolean) => void) | null = null

/** App-wide confirm; resolves true if user confirms. */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  if (resolver) {
    resolver(false)
    resolver = null
  }
  const o = typeof opts === 'string' ? { message: opts } : opts
  confirmState.title = o.title ?? '确认'
  confirmState.message = o.message
  confirmState.confirmText = o.confirmText ?? '确定'
  confirmState.cancelText = o.cancelText ?? '取消'
  confirmState.danger = Boolean(o.danger)
  confirmState.open = true

  return new Promise<boolean>((resolve) => {
    resolver = resolve
  })
}

export function resolveConfirm(ok: boolean) {
  if (!confirmState.open) return
  confirmState.open = false
  const r = resolver
  resolver = null
  r?.(ok)
}
