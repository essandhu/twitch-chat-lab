import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessageFragment } from '../../types/twitch'
import {
  accountAgeBucket,
  emoteVsTextRatio,
  jaccardSimilarity,
  lexicalDiversity,
  newChatterInflux,
  similarityBurst,
} from './signalMath'

const NOW = 1_000_000_000

const makeMessage = (opts: {
  id?: string
  text?: string
  userId?: string
  timestamp?: number
  fragments?: MessageFragment[]
}): ChatMessage => {
  const text = opts.text ?? 'hello world'
  return {
    id: opts.id ?? Math.random().toString(36).slice(2),
    userId: opts.userId ?? 'u1',
    userLogin: 'u1',
    displayName: 'U1',
    color: '#fff',
    badges: [],
    fragments: opts.fragments ?? [{ type: 'text', text }],
    text,
    isFirstInSession: false,
    isHighlighted: false,
    timestamp: new Date(opts.timestamp ?? NOW),
    messageType: 'text',
  }
}

describe('jaccardSimilarity', () => {
  it('empty-intersect-empty returns 0', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0)
  })
  it('identical sets return 1', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })
  it('disjoint sets return 0', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0)
  })
  it('half overlap returns 1/3', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 6)
  })
})

describe('similarityBurst', () => {
  it('returns 0 when fewer than 2 messages in window', () => {
    expect(similarityBurst([makeMessage({ timestamp: NOW })], NOW)).toBe(0)
    expect(similarityBurst([], NOW)).toBe(0)
  })
  it('10 identical copypastas scores > 0.9', () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMessage({ id: String(i), text: 'go go go go go copypasta time', timestamp: NOW - i * 100 }),
    )
    expect(similarityBurst(msgs, NOW)).toBeGreaterThan(0.9)
  })
  it('mixed chatter scores < 0.2', () => {
    const texts = [
      'the quick brown fox jumps',
      'lorem ipsum dolor sit amet',
      'random unrelated thoughts today',
      'weather is rather nice outside',
      'coffee tastes better this morning',
    ]
    const msgs = texts.map((t, i) => makeMessage({ id: String(i), text: t, timestamp: NOW - i * 100 }))
    expect(similarityBurst(msgs, NOW)).toBeLessThan(0.2)
  })
  it('excludes messages at or before window boundary', () => {
    const msgs = [
      makeMessage({ id: '1', text: 'foo bar baz qux', timestamp: NOW - 10_000 }),
      makeMessage({ id: '2', text: 'foo bar baz qux', timestamp: NOW - 5_000 }),
    ]
    expect(similarityBurst(msgs, NOW)).toBe(0)
  })
})

describe('lexicalDiversity', () => {
  it('returns 0 when fewer than 20 tokens', () => {
    const msgs = [makeMessage({ text: 'short one', timestamp: NOW })]
    expect(lexicalDiversity(msgs, NOW, 0.9)).toBe(0)
  })
  it('all-unique tokens produce near-zero drop vs baseline', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
    const msgs = [makeMessage({ text: words, timestamp: NOW })]
    expect(lexicalDiversity(msgs, NOW, 1)).toBeLessThan(0.05)
  })
  it('repeat-phrase flooding approaches 1', () => {
    const pasta = Array.from({ length: 30 }, () => 'a').join(' ')
    const msgs = [makeMessage({ text: pasta, timestamp: NOW })]
    expect(lexicalDiversity(msgs, NOW, 1)).toBeGreaterThan(0.9)
  })
  it('zero baseline returns 0', () => {
    const msgs = Array.from({ length: 5 }, (_, i) =>
      makeMessage({ id: String(i), text: 'some varied words here and there and more', timestamp: NOW - i }),
    )
    expect(lexicalDiversity(msgs, NOW, 0)).toBe(0)
  })
})

describe('emoteVsTextRatio', () => {
  it('100% emote → 1', () => {
    const msgs = [
      makeMessage({
        timestamp: NOW,
        fragments: [
          { type: 'emote', text: 'Pog', emote: { id: '1' } },
          { type: 'emote', text: 'KEKW', emote: { id: '2' } },
        ],
      }),
    ]
    expect(emoteVsTextRatio(msgs, NOW)).toBe(1)
  })
  it('100% text → 0', () => {
    const msgs = [makeMessage({ timestamp: NOW, fragments: [{ type: 'text', text: 'hi' }] })]
    expect(emoteVsTextRatio(msgs, NOW)).toBe(0)
  })
  it('mixed 50/50 → 0.5', () => {
    const msgs = [
      makeMessage({
        timestamp: NOW,
        fragments: [
          { type: 'text', text: 'yo' },
          { type: 'emote', text: 'Pog', emote: { id: '1' } },
        ],
      }),
    ]
    expect(emoteVsTextRatio(msgs, NOW)).toBe(0.5)
  })
  it('empty window → 0', () => {
    expect(emoteVsTextRatio([], NOW)).toBe(0)
  })
})

describe('newChatterInflux', () => {
  it('all-known users → 0', () => {
    const seen = new Set(['u1', 'u2'])
    const msgs = [makeMessage({ userId: 'u1', timestamp: NOW }), makeMessage({ userId: 'u2', timestamp: NOW - 1 })]
    expect(newChatterInflux(msgs, seen, NOW)).toBe(0)
  })
  it('all-new → 1', () => {
    const msgs = [makeMessage({ userId: 'u1', timestamp: NOW }), makeMessage({ userId: 'u2', timestamp: NOW - 1 })]
    expect(newChatterInflux(msgs, new Set(), NOW)).toBe(1)
  })
  it('mixed exact ratio', () => {
    const seen = new Set(['u1'])
    const msgs = [
      makeMessage({ userId: 'u1', timestamp: NOW }),
      makeMessage({ userId: 'u2', timestamp: NOW - 1 }),
      makeMessage({ userId: 'u3', timestamp: NOW - 2 }),
      makeMessage({ userId: 'u4', timestamp: NOW - 3 }),
    ]
    expect(newChatterInflux(msgs, seen, NOW)).toBe(0.75)
  })
  it('empty window → 0', () => {
    expect(newChatterInflux([], new Set(), NOW)).toBe(0)
  })
})

describe('accountAgeBucket', () => {
  it('id=1 → established', () => {
    expect(accountAgeBucket('1')).toBe('established')
  })
  it('id=9e10 (top of calibration) → new', () => {
    expect(accountAgeBucket('90000000000')).toBe('new')
  })
  it('non-numeric → unknown', () => {
    expect(accountAgeBucket('abc')).toBe('unknown')
    expect(accountAgeBucket('')).toBe('unknown')
  })
  it('mid-range id returns a bucket from the domain', () => {
    const b = accountAgeBucket('500000000')
    expect(['new', 'recent', 'established']).toContain(b)
  })
})
