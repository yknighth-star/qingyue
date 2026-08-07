import { describe, expect, it } from 'vitest'
import { resolveReaderBg } from '@/utils/pageEpubTurn'

describe('epub turn helpers', () => {
  it('resolveReaderBg prefers --reader-bg', () => {
    const el = document.createElement('div')
    el.style.setProperty('--reader-bg', '#c7e0c7')
    el.style.backgroundColor = 'rgb(0, 0, 0)'
    document.body.appendChild(el)
    expect(resolveReaderBg(el)).toBe('#c7e0c7')
    el.remove()
  })

  it('resolveReaderBg falls back to parchment', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(resolveReaderBg(el)).toMatch(/#f3ead3|rgb/i)
    el.remove()
  })
})
