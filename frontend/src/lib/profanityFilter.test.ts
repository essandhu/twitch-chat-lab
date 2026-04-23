import { describe, expect, it } from 'vitest'
import { censorText } from './profanityFilter'

// A single known-profane word from obscenity's english dataset, constructed
// from char codes so no literal profanity appears in the source file.
const MILD = String.fromCharCode(97, 115, 115, 104, 111, 108, 101) // 7 chars

describe('censorText', () => {
  it('returns the text unchanged when disabled', () => {
    const input = `this is ${MILD} bad`
    expect(censorText(input, false)).toBe(input)
  })

  it('returns empty string unchanged when enabled', () => {
    expect(censorText('', true)).toBe('')
  })

  it('returns benign text unchanged when enabled', () => {
    expect(censorText('hello world, how are you?', true)).toBe(
      'hello world, how are you?',
    )
  })

  it('censors a known profane word, preserving first letter', () => {
    const out = censorText(`oh ${MILD}`, true)
    expect(out).not.toContain(MILD)
    expect(out.startsWith('oh ')).toBe(true)
    expect(out).toMatch(/oh [a-zA-Z]\*+/)
  })

  it('preserves surrounding punctuation', () => {
    const out = censorText(`"${MILD}," he said`, true)
    expect(out.endsWith('," he said')).toBe(true)
    expect(out).not.toContain(MILD)
  })

  it('leaves benign words alone', () => {
    expect(censorText('attend class today', true)).toBe('attend class today')
    expect(censorText('the assassin ran', true)).toBe('the assassin ran')
  })

  it('preserves overall string length (1-to-1 char substitution)', () => {
    const input = `wow ${MILD}!`
    const out = censorText(input, true)
    expect(out.length).toBe(input.length)
  })
})
