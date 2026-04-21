import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types/twitch'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../../store/intelligenceStore'
import { computeBands } from './AnomalyOverlay'

vi.mock('../../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

const BASELINE_WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'hey', 'chat',
  'wow', 'nice', 'play', 'game', 'stream', 'vibes', 'keep', 'going', 'love',
  'this', 'really', 'cool', 'moment', 'anyone', 'watching', 'tonight', 'later',
  'morning', 'afternoon', 'evening', 'thanks', 'stranger', 'funny', 'serious',
  'question', 'answer', 'maybe', 'definitely', 'never', 'always', 'sometimes',
  'yellow', 'green', 'purple', 'orange', 'blue', 'red', 'black', 'white',
  'coffee', 'tea', 'bread', 'cake', 'music', 'art', 'code', 'book', 'film',
  'dance', 'sleep', 'run', 'walk', 'swim', 'climb', 'sing', 'jump', 'drive',
  'clean', 'messy', 'fast', 'slow', 'bright', 'dim', 'loud', 'quiet', 'tall',
  'short', 'big', 'small', 'hot', 'cold', 'sweet', 'salty', 'sour', 'bitter',
]

const rng = (seed: number) => {
  let s = seed | 0
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 0xffffffff
  }
}

const BASELINE_CORPUS = (() => {
  const r = rng(42)
  const out: string[] = []
  for (let i = 0; i < 120; i++) {
    const len = 6 + Math.floor(r() * 6)
    const words: string[] = []
    for (let j = 0; j < len; j++) {
      words.push(BASELINE_WORDS[Math.floor(r() * BASELINE_WORDS.length)])
    }
    out.push(words.join(' '))
  }
  return out
})()

const COPYPASTA = 'HAHAHA COPYPASTA GO BRRRR yes'

const makeMsg = (id: string, text: string, timestamp: number, userId: string): ChatMessage => ({
  id,
  userId,
  userLogin: userId,
  displayName: userId,
  color: '#fff',
  badges: [],
  fragments: [{ type: 'text', text }],
  text,
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(timestamp),
  messageType: 'text',
})

describe('intelligence integration — scripted session with copypasta burst', () => {
  beforeEach(() => {
    useIntelligenceStore.getState().reset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('burst elevates raidBand past calm within 5 s and AnomalyOverlay renders', () => {
    const store = useIntelligenceStore.getState()

    // Seed baseline up to t=240s with per-second ticks.
    let seq = 0
    for (let t = 0; t < 240_000; t += 1000) {
      const text = BASELINE_CORPUS[seq % BASELINE_CORPUS.length]
      store.ingestMessage(makeMsg(`m${seq}`, text, t, `baseline_user_${seq % 50}`))
      seq++
      store.tick(t)
    }

    // During baseline the band should never leave 'calm'.
    const baselineHistory = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY].signalHistory
    for (const entry of baselineHistory) {
      // Heuristic: similarityBurst stays low in baseline.
      expect(entry.similarityBurst).toBeLessThan(0.5)
    }

    // Burst: 40 identical copypasta messages over 5 seconds (one every 125 ms).
    for (let i = 0; i < 40; i++) {
      const t = 240_000 + i * 125
      store.ingestMessage(makeMsg(`burst${seq}`, COPYPASTA, t, `raider_${i}`))
      seq++
    }

    // Tick at t=241s (1 s into burst; some messages landed).
    store.tick(241_000)
    // Tick at t=242s (2 s into burst — similarityBurst should be clearly elevated).
    store.tick(242_000)
    const at242 = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]
    expect(at242.anomalySignals.similarityBurst).toBeGreaterThan(0.5)

    // Tick at t=243s — band elevated or higher.
    store.tick(243_000)
    const at243 = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]
    expect(['elevated', 'high', 'critical']).toContain(at243.raidBand)

    // Tick at t=245s — band 'high' or higher.
    store.tick(245_000)
    const at245 = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]
    expect(['high', 'critical']).toContain(at245.raidBand)

    // AnomalyOverlay band computation returns at least one non-calm band spanning the burst.
    const history = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY].signalHistory
    const bands = computeBands(history)
    expect(bands.length).toBeGreaterThan(0)
    expect(bands.some((b) => b.band === 'elevated' || b.band === 'high' || b.band === 'critical')).toBe(true)
    const covering = bands.find((b) => b.start <= 245_000 && b.end >= 242_000)
    expect(covering).toBeDefined()
  })
})

