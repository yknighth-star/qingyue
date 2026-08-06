import type { BookFormat } from '@/types'
import type { ReaderEngine } from './types'
import { EpubEngine } from './epubEngine'
import { PdfEngine } from './pdfEngine'
import { TxtEngine } from './txtEngine'

export function createEngine(format: BookFormat): ReaderEngine {
  if (format === 'txt') return new TxtEngine()
  if (format === 'epub') return new EpubEngine()
  return new PdfEngine()
}
