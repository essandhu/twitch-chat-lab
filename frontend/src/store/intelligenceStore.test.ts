import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MessageFragment } from '../types/twitch'

vi.mock('../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

import { PRIMARY_STREAM_KEY, useIntelligenceStore } from './intelligenceStore'

const makeMsg = (opts: {
  id: string
  text?: string
  userId?: string
  timestamp?: number
  fragments?: MessageFragment[]
  cheer?: { bits: number }
}): ChatMessage => {
  const text = opts.text ?? 'hello world one two three four'
  return {
    id: opts.id,
    userId: opts.userId ?? 'u1',
    userLogin: 'u1',
    displayName: 'U1',
    color: '#fff',
    badges: [],
    fragments: opts.fragments ?? [{ type: 'text', text }],
    text,
    isFirstInSession: false,
    isHighlighted: false,
    timestamp: new Date(opts.timestamp ?? 1_000),
    cheer: opts.cheer,
    messageType: 'text',
  }
}

describe('intelligenceStore', () => {
  beforeEach(() => {
    useIntelligenceStore.getState().reset()
  })

  it('ingestMessage without streamLogin writes to PRIMARY_STREAM_KEY', () => {
    useIntelligenceStore.getState().ingestMessage(makeMsg({ id: 'm1' }))
    const slices = useIntelligenceStore.getState().slices
    expect(slices[PRIMARY_STREAM_KEY]).toBeDefined()
    expect(slices[PRIMARY_STREAM_KEY].recentMessages).toHaveLength(1)
  })

  it('PRIMARY_STREAM_KEY equals "__primary__" and does not collide with legal login "_primary"', () => {
    expect(PRIMARY_STREAM_KEY).toBe('__primary__')
    useIntelligenceStore.getState().ingestMessage(makeMsg({ id: 'a' }))
    useIntelligenceStore.getState().ingestMessage(makeMsg({ id: 'b' }), '_primary')
    const slices = useIntelligenceStore.getState().slices
    expect(slices[PRIMARY_STREAM_KEY].recentMessages).toHaveLength(1)
    expect(slices['_primary'].recentMessages).toHaveLength(1)
    expect(slices[PRIMARY_STREAM_KEY].recentMessages[0].id).toBe('a')
    expect(slices['_primary'].recentMessages[0].id).toBe('b')
  })

  it('isolates slices between streamLogin and primary', () => {
    useIntelligenceStore.getState().ingestMessage(makeMsg({ id: 'p1' }))
    useIntelligenceStore.getState().ingestMessage(makeMsg({ id: 's1' }), 'alpha')
    const { slices } = useIntelligenceStore.getState()
    expect(slices[PRIMARY_STREAM_KEY].recentMessages.map((m) => m.id)).toEqual(['p1'])
    expect(slices['alpha'].recentMessages.map((m) => m.id)).toEqual(['s1'])
  })

  it('caps extractedSignals.questions at 200 (oldest dropped)', () => {
    const store = useIntelligenceStore.getState()
    for (let i = 0; i < 201; i++) {
      store.ingestMessage(makeMsg({ id: `q${i}`, text: `how does this work number ${i} times` }))
    }
    const qs = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY].extractedSignals.questions
    expect(qs).toHaveLength(200)
    expect(qs[0].messageId).toBe('q1')
    expect(qs[199].messageId).toBe('q200')
  })

  it('tick recomputes anomalySignals + raidRiskScore + raidBand', () => {
    const store = useIntelligenceStore.getState()
    for (let i = 0; i < 12; i++) {
      store.ingestMessage(
        makeMsg({ id: `m${i}`, text: 'HAHAHA COPYPASTA GO GO GO', userId: `u${i}`, timestamp: 10_000 + i * 100 }),
      )
    }
    store.tick(11_500)
    const slice = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]
    expect(slice.anomalySignals.similarityBurst).toBeGreaterThan(0.5)
    expect(slice.raidRiskScore).toBeGreaterThan(0)
    expect(['elevated', 'high', 'critical']).toContain(slice.raidBand)
  })

  it('tick appends to signalHistory and caps at 60 entries', () => {
    const store = useIntelligenceStore.getState()
    store.ingestMessage(makeMsg({ id: 'seed', text: 'seed', timestamp: 0 }))
    for (let i = 0; i < 70; i++) store.tick(1000 + i * 1000)
    const slice = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]
    expect(slice.signalHistory).toHaveLength(60)
  })

  it('reset(login) clears only the specified slice', () => {
    const store = useIntelligenceStore.getState()
    store.ingestMessage(makeMsg({ id: 'p' }))
    store.ingestMessage(makeMsg({ id: 'a' }), 'alpha')
    store.reset('alpha')
    const { slices } = useIntelligenceStore.getState()
    expect(slices[PRIMARY_STREAM_KEY]).toBeDefined()
    expect(slices['alpha']).toBeUndefined()
  })

  it('reset() clears all slices', () => {
    const store = useIntelligenceStore.getState()
    store.ingestMessage(makeMsg({ id: 'p' }))
    store.ingestMessage(makeMsg({ id: 'a' }), 'alpha')
    store.reset()
    expect(Object.keys(useIntelligenceStore.getState().slices)).toHaveLength(0)
  })

  it('ingestMessage records cheers into bitsContext', () => {
    useIntelligenceStore.getState().ingestMessage(
      makeMsg({ id: 'bits1', text: 'cheer100 yay', cheer: { bits: 100 } }),
    )
    const bc = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY].extractedSignals.bitsContext
    expect(bc.map((r) => r.messageId)).toEqual(['bits1'])
  })

  it('extractCallouts fires when broadcaster is provided', () => {
    useIntelligenceStore
      .getState()
      .ingestMessage(makeMsg({ id: 'c1', text: 'hi @broadcaster how are you' }), undefined, {
        login: 'broadcaster',
        displayName: 'Broadcaster',
      })
    const callouts = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY].extractedSignals.callouts
    expect(callouts.map((r) => r.messageId)).toEqual(['c1'])
  })
})
