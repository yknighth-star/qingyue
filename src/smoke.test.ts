import { describe, expect, it } from 'vitest'
import { detectFormat, titleFromFilename } from '@/storage/types'
import { highlightAnnotInRoot } from '@/utils/domHighlight'
import { FULL_ENGINE_CAPABILITIES } from '@/engines/types'
import { indexOfIgnoreCase } from '@/utils/searchText'
import { formatPageLabel } from '@/utils/format'

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
    expect(FULL_ENGINE_CAPABILITIES.offlineOcr).toBe(false)
  })
})

describe('turn profile (phone / tablet / desktop)', () => {
  it('maps width bands and curl budget', async () => {
    const { resolveTurnProfile, resolveTurnAnim } = await import('@/utils/turnProfile')
    const phone = resolveTurnProfile(390)
    expect(phone.device).toBe('phone')
    expect(phone.curlAnim).toBe('lite-curl')
    expect(phone.edgeWidth).toBeLessThan(0.15)

    const tablet = resolveTurnProfile(900)
    expect(tablet.device).toBe('tablet')
    expect(tablet.dualEligible).toBe(false)

    const desktop = resolveTurnProfile(1280)
    expect(desktop.device).toBe('desktop')
    expect(desktop.dualEligible).toBe(true)

    expect(resolveTurnAnim('scroll', phone)).toBe('none')
    expect(resolveTurnAnim('slide', phone)).toBe('slide')
    expect(resolveTurnAnim('curl', phone)).toBe('lite-curl')
    // 仿真不得 silently 等于横滑
    expect(resolveTurnAnim('curl', phone)).not.toBe(resolveTurnAnim('slide', phone))
  })
})

describe('ocr helpers', () => {
  it('detects sparse embedded text', async () => {
    const { isSparseText } = await import('@/utils/offlineOcr')
    expect(isSparseText('')).toBe(true)
    expect(isSparseText('abc')).toBe(true)
    expect(isSparseText('这是一段足够长的可用于判断是否需要OCR的正文内容示例文字')).toBe(false)
  })
})

describe('author helpers', () => {
  it('normalizes legacy placeholders and exports 佚名 when empty', async () => {
    const { normalizeAuthor, displayAuthor, authorOrAnonymous } = await import('@/utils/author')
    expect(normalizeAuthor('未知作者')).toBe('')
    expect(normalizeAuthor('M2102K1C')).toBe('')
    expect(normalizeAuthor('eYOU-SEPG')).toBe('')
    expect(normalizeAuthor('  烽火戏诸侯  ')).toBe('烽火戏诸侯')
    expect(displayAuthor('未知作者')).toBe('')
    expect(authorOrAnonymous('')).toBe('佚名')
    expect(authorOrAnonymous('佚名')).toBe('佚名')
  })
})

describe('reading progress labels', () => {
  it('uses lastReadAt so opened books are not 未读 at 0%', async () => {
    const { readingProgressLabel, isUnread, isCurrentlyReading } = await import(
      '@/utils/readingProgress'
    )
    expect(readingProgressLabel({ progressPercent: 0 })).toBe('未读')
    expect(isUnread({ progressPercent: 0 })).toBe(true)
    expect(readingProgressLabel({ progressPercent: 0, lastReadAt: 1 })).toBe('在读')
    expect(isCurrentlyReading({ progressPercent: 0, lastReadAt: 1 })).toBe(true)
    expect(readingProgressLabel({ progressPercent: 0.2, lastReadAt: 1 })).toBe('<1%')
    expect(readingProgressLabel({ progressPercent: 7, lastReadAt: 1 })).toBe('7%')
    expect(readingProgressLabel({ progressPercent: 99 })).toBe('读完')
  })
})

describe('book title pick', () => {
  it('drops placeholder metadata and falls back to filename', async () => {
    const { sanitizeMetaTitle, pickBookTitle, isPlaceholderTitle } = await import('@/utils/bookMeta')
    expect(sanitizeMetaTitle('项目名称')).toBeUndefined()
    expect(sanitizeMetaTitle('空白演示')).toBeUndefined()
    expect(sanitizeMetaTitle('城际拼车产品手册')).toBe('城际拼车产品手册')
    expect(isPlaceholderTitle('项目名称')).toBe(true)
    expect(pickBookTitle('项目名称', '城际拼车手册.pdf')).toBe('城际拼车手册')
    expect(pickBookTitle('剑来', 'other.epub')).toBe('剑来')
  })
})

describe('epub cover resolution', () => {
  it('finds cover via meta + href-before-id item order', async () => {
    const { parseManifestItems, resolveEpubCoverHref } = await import('@/storage/meta')
    const opf = `
      <metadata><meta name="cover" content="c1"/></metadata>
      <manifest>
        <item href="Images/Cover.jpg" id="c1" media-type="image/jpeg"/>
      </manifest>`
    const items = parseManifestItems(opf)
    expect(resolveEpubCoverHref(opf, items)).toBe('Images/Cover.jpg')
  })

  it('finds EPUB3 cover-image property', async () => {
    const { parseManifestItems, resolveEpubCoverHref } = await import('@/storage/meta')
    const opf = `
      <manifest>
        <item id="img" href="cover.png" media-type="image/png" properties="cover-image"/>
      </manifest>`
    const items = parseManifestItems(opf)
    expect(resolveEpubCoverHref(opf, items)).toBe('cover.png')
  })
})

describe('page label', () => {
  it('formats exact / estimate / chapter / percent fallback', () => {
    expect(formatPageLabel({ percent: 24, page: 128, pageCount: 520, pageMode: 'exact' })).toBe(
      '128 / 520',
    )
    expect(formatPageLabel({ percent: 10, page: 12, pageCount: 80, pageMode: 'estimate' })).toBe(
      '约 12 / 80',
    )
    expect(formatPageLabel({ percent: 5, page: 2, pageCount: 9, pageMode: 'chapter' })).toBe(
      '本节 2 / 9',
    )
    expect(formatPageLabel({ percent: 33 })).toBe('33%')
  })
})
