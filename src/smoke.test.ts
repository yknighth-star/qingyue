import { describe, expect, it } from 'vitest'
import { detectFormat, titleFromFilename } from '@/storage/types'
import { highlightAnnotInRoot } from '@/utils/domHighlight'
import { FULL_ENGINE_CAPABILITIES } from '@/engines/types'
import { indexOfIgnoreCase } from '@/utils/searchText'

describe('storage helpers', () => {
  it('detects formats from filenames', () => {
    expect(detectFormat('a.epub')).toBe('epub')
    expect(detectFormat('B.PDF')).toBe('pdf')
    expect(detectFormat('notes.txt')).toBe('txt')
    expect(detectFormat('readme.md')).toBeNull()
  })

  it('strips extension for titles', () => {
    expect(titleFromFilename('我的书.epub')).toBe('我的书')
    expect(titleFromFilename('report.PDF')).toBe('report')
  })
})

describe('search + highlight smoke', () => {
  it('finds case-insensitive matches', () => {
    expect(indexOfIgnoreCase('Hello World', 'world')).toBe(6)
    expect(indexOfIgnoreCase('中文测试', '文测')).toBe(1)
  })

  it('wraps needle across adjacent text nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span>Hello </span><span>World</span>'
    const ok = highlightAnnotInRoot(root, 'Hello World', '#ff0')
    expect(ok).toBe(true)
    expect(root.querySelectorAll('mark.annot').length).toBeGreaterThan(0)
    expect(root.textContent).toBe('Hello World')
  })
})

describe('engine capabilities', () => {
  it('exposes full capability flags for UI gating', () => {
    expect(FULL_ENGINE_CAPABILITIES.search).toBe(true)
    expect(FULL_ENGINE_CAPABILITIES.textHighlights).toBe(true)
    expect(FULL_ENGINE_CAPABILITIES.annotations).toBe(true)
    expect(FULL_ENGINE_CAPABILITIES.percentJump).toBe(true)
  })
})
