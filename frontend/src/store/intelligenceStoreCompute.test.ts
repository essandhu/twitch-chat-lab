import { describe, expect, it } from 'vitest'
import { pushCapped, ttrForWindow, createSlice, emptySignals } from './intelligenceStoreCompute'
import type { ChatMessage } from '../types/twitch'

describe('intelligenceStoreCompute', () => {
  describe('pushCapped', () => {
    it('enforces cap when input exceeds cap (210 entries pushed to cap=200)', () => {
      let arr: number[] = []
      for (let i = 0; i < 210; i++) arr = pushCapped(arr, i, 200)
      expect(arr.length).toBe(200)
      expect(arr[0]).toBe(10)
      expect(arr[199]).toBe(209)
    })

    it('keeps items when under cap', () => {
      const arr = pushCapped([1, 2, 3], 4, 10)
      expect(arr).toEqual([1, 2, 3, 4])
    })

    it('is a non-mutating push', () => {
      const source = [1, 2, 3]
      pushCapped(source, 4, 10)
      expect(source).toEqual([1, 2, 3])
    })
  })

  describe('ttrForWindow', () => {
    const mkMsg = (text: string, t: number): ChatMessage => ({
      id: `m-${t}`,
      userId: 'u',
      userLogin: 'u',
      displayName: 'U',
      color: '#fff',
      badges: [],
      fragments: [{ type: 'text', text }],
      text,
      isFirstInSession: false,
      isHighlighted: false,
      timestamp: new Date(t),
      messageType: 'text',
    })

    it('returns 0 for empty window', () => {
      expect(ttrForWindow([], 100_000)).toBe(0)
    })

    it('ignores messages outside the 60s window', () => {
      const msgs = [mkMsg('alpha beta', 0), mkMsg('gamma delta', 100_000)]
      // nowMs=100_000, window is 40_000..100_000 so only the second message counts
      const ttr = ttrForWindow(msgs, 100_000)
      expect(ttr).toBeCloseTo(1, 5)
    })

    it('computes type-token ratio over the in-window messages', () => {
      const msgs = [
        mkMsg('pog pog pog', 95_000),
        mkMsg('lol wat', 95_500),
      ]
      // tokens: pog pog pog lol wat = 5 tokens, 3 unique -> 0.6
      expect(ttrForWindow(msgs, 100_000)).toBeCloseTo(0.6, 5)
    })
  })

  describe('createSlice / emptySignals', () => {
    it('creates an isolated slice each call', () => {
      const a = createSlice()
      const b = createSlice()
      a.recentMessages.push({} as ChatMessage)
      expect(b.recentMessages).toHaveLength(0)
      expect(a.anomalySignals).toEqual(emptySignals)
    })
  })
})
