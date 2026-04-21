import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelChatMessageEvent } from '../types/twitch'
import { useMultiStreamStore } from './multiStreamStore'

const base = new Date('2025-01-01T00:00:00Z').getTime()

const makeRawEvent = (
  userId: string,
  text: string,
  overrides: Partial<ChannelChatMessageEvent> = {},
): ChannelChatMessageEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: userId,
  chatter_user_login: `user_${userId}`,
  chatter_user_name: `User${userId}`,
  message_id: `m_${userId}_${text.slice(0, 5)}_${Math.random().toString(36).slice(2, 8)}`,
  message: {
    text,
    fragments: [{ type: 'text', text }],
  },
  color: '#ffffff',
  badges: [],
  message_type: 'text',
  ...overrides,
})

describe('multiStreamStore', () => {
  beforeEach(() => {
    useMultiStreamStore.getState().reset()
  })

  it('addStream and removeStream update order and streams; reset wipes both', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })

    let state = useMultiStreamStore.getState()
    expect(state.order).toEqual(['alice', 'bob'])
    expect(state.streams.alice?.login).toBe('alice')
    expect(state.streams.alice?.displayName).toBe('Alice')
    expect(state.streams.alice?.broadcasterId).toBe('b_alice')
    expect(state.streams.bob?.login).toBe('bob')

    state.removeStream('alice')
    state = useMultiStreamStore.getState()
    expect(state.order).toEqual(['bob'])
    expect(state.streams.alice).toBeUndefined()
    expect(state.streams.bob).toBeDefined()

    state.reset()
    state = useMultiStreamStore.getState()
    expect(state.order).toEqual([])
    expect(state.streams).toEqual({})
  })

  it('addMessage enforces the 5000-message cap per stream (sliding window)', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })

    for (let i = 0; i < 5001; i += 1) {
      useMultiStreamStore.getState().addMessage('alice', makeRawEvent(`u${i}`, `msg ${i}`))
    }

    const slice = useMultiStreamStore.getState().streams.alice
    expect(slice?.messages).toHaveLength(5000)
    expect(slice?.messages[0]?.text).toBe('msg 1')
    expect(slice?.messages[4999]?.text).toBe('msg 5000')
  })

  it('first-in-session detection is per-stream', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })

    // Same user_id seen in alice's slice — first time
    useMultiStreamStore.getState().addMessage('alice', makeRawEvent('u1', 'hi A'))
    // Same user_id seen again in alice — not first time
    useMultiStreamStore.getState().addMessage('alice', makeRawEvent('u1', 'hi A again'))
    // Same user_id seen in bob's slice — independently first time for bob
    useMultiStreamStore.getState().addMessage('bob', makeRawEvent('u1', 'hi B'))

    const state = useMultiStreamStore.getState()
    const alice = state.streams.alice
    const bob = state.streams.bob

    expect(alice?.messages[0]?.isFirstInSession).toBe(true)
    expect(alice?.messages[1]?.isFirstInSession).toBe(false)
    expect(alice?.firstTimers).toHaveLength(1)
    expect(alice?.seenUserIds.has('u1')).toBe(true)

    expect(bob?.messages[0]?.isFirstInSession).toBe(true)
    expect(bob?.firstTimers).toHaveLength(1)
    expect(bob?.seenUserIds.has('u1')).toBe(true)
  })

  it('incrementCounter + tickAll produces a HeatmapDataPoint per slice, resets _counter, tracks peakMsgPerSec', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(base))

    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })

    const sa = useMultiStreamStore.getState()
    sa.incrementCounter('alice')
    sa.incrementCounter('alice')
    sa.incrementCounter('alice')
    sa.incrementCounter('bob')

    useMultiStreamStore.getState().tickAll(Date.now())

    let state = useMultiStreamStore.getState()
    expect(state.streams.alice?.dataPoints).toHaveLength(1)
    expect(state.streams.alice?.dataPoints[0]?.msgPerSec).toBe(3)
    expect(state.streams.alice?.currentMsgPerSec).toBe(3)
    expect(state.streams.alice?.peakMsgPerSec).toBe(3)
    expect(state.streams.alice?._counter).toBe(0)

    expect(state.streams.bob?.dataPoints).toHaveLength(1)
    expect(state.streams.bob?.dataPoints[0]?.msgPerSec).toBe(1)
    expect(state.streams.bob?.peakMsgPerSec).toBe(1)
    expect(state.streams.bob?._counter).toBe(0)

    // Next tick with a smaller count — peak should stay at 3 for alice
    vi.setSystemTime(new Date(base + 1000))
    useMultiStreamStore.getState().incrementCounter('alice')
    useMultiStreamStore.getState().tickAll(Date.now())

    state = useMultiStreamStore.getState()
    expect(state.streams.alice?.dataPoints).toHaveLength(2)
    expect(state.streams.alice?.currentMsgPerSec).toBe(1)
    expect(state.streams.alice?.peakMsgPerSec).toBe(3)

    vi.useRealTimers()
  })

  it('tickAll trims dataPoints to 300 entries per slice', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(base))

    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })

    for (let i = 0; i < 301; i += 1) {
      vi.setSystemTime(new Date(base + i * 1000))
      useMultiStreamStore.getState().incrementCounter('alice')
      useMultiStreamStore.getState().tickAll(Date.now())
    }

    const slice = useMultiStreamStore.getState().streams.alice
    expect(slice?.dataPoints).toHaveLength(300)
    expect(slice?.dataPoints[0]?.timestamp).toBe(base + 1000)
    expect(slice?.dataPoints[299]?.timestamp).toBe(base + 300_000)

    vi.useRealTimers()
  })

  it('new slices start in connecting state', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    expect(useMultiStreamStore.getState().streams.alice?.connectionState).toBe('connecting')
  })

  it('markReady promotes connecting -> ready, leaves degraded alone', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })

    // Degrade bob first — markReady must not silently resurrect it.
    useMultiStreamStore.getState().setDegraded('bob', true)

    useMultiStreamStore.getState().markReady('alice')
    useMultiStreamStore.getState().markReady('bob')

    const state = useMultiStreamStore.getState()
    expect(state.streams.alice?.connectionState).toBe('ready')
    expect(state.streams.bob?.connectionState).toBe('degraded')
  })

  it('addMessage flips connecting -> ready but leaves degraded alone', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })
    useMultiStreamStore.getState().setDegraded('bob', true)

    useMultiStreamStore.getState().addMessage('alice', makeRawEvent('u1', 'hi'))
    useMultiStreamStore.getState().addMessage('bob', makeRawEvent('u2', 'hi'))

    const state = useMultiStreamStore.getState()
    expect(state.streams.alice?.connectionState).toBe('ready')
    expect(state.streams.bob?.connectionState).toBe('degraded')
  })

  it('setDegraded(login, false) flips back to ready', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    useMultiStreamStore.getState().setDegraded('alice', true)
    expect(useMultiStreamStore.getState().streams.alice?.connectionState).toBe('degraded')
    useMultiStreamStore.getState().setDegraded('alice', false)
    expect(useMultiStreamStore.getState().streams.alice?.connectionState).toBe('ready')
  })

  it('setActive(false) and reset() clear isActive and every slice', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.setActive(true)
    expect(useMultiStreamStore.getState().isActive).toBe(true)

    useMultiStreamStore.getState().setActive(false)
    expect(useMultiStreamStore.getState().isActive).toBe(false)

    useMultiStreamStore.getState().setActive(true)
    useMultiStreamStore.getState().reset()
    const after = useMultiStreamStore.getState()
    expect(after.isActive).toBe(false)
    expect(after.streams).toEqual({})
    expect(after.order).toEqual([])
  })
})

// Keep imports used across the spec
afterEach(() => {
  vi.useRealTimers()
})
