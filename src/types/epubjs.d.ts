declare module 'epubjs' {
  export interface NavItem {
    id?: string
    href: string
    label: string
    subitems?: NavItem[]
  }

  export interface Book {
    ready: Promise<unknown>
    opened: Promise<Book>
    spine: unknown
    navigation?: { toc: NavItem[] }
    destroy(): void
    renderTo(
      element: HTMLElement,
      options: Record<string, unknown>,
    ): Rendition
  }

  export interface Rendition {
    display(target?: string | number): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    destroy(): void
    on(event: string, cb: (...args: unknown[]) => void): void
    themes: { default(rules: Record<string, Record<string, string>>): void }
    currentLocation(): unknown
    getContents?: () => { window: Window }[]
    getRange?: (cfi: string) => Range | null
  }

  export default function ePub(
    url?: string | ArrayBuffer | Blob,
    options?: { openAs?: string; replacements?: string },
  ): Book
}
