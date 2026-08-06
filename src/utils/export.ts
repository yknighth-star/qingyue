import type { AnnotationRecord, BookRecord } from '@/types'

export function annotationsToMarkdown(book: BookRecord, annots: AnnotationRecord[]): string {
  const lines = [`# ${book.title}`, `作者：${book.author}`, '', '## 标注', '']
  for (const a of annots) {
    lines.push(`### ${a.type} · ${new Date(a.createdAt).toLocaleString()}`)
    if (a.selectedText) lines.push(`> ${a.selectedText}`)
    if (a.note) lines.push(a.note)
    lines.push('')
  }
  return lines.join('\n')
}

export function annotationsToJson(book: BookRecord, annots: AnnotationRecord[]): string {
  return JSON.stringify({ book: { title: book.title, author: book.author, id: book.id }, annotations: annots }, null, 2)
}

export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
