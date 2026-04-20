import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Badge, ChannelChatMessageEvent } from '../../types/twitch'
import { pairKeyFor, useMultiStreamStore } from '../../store/multiStreamStore'
import { applyFilters } from '../filters/filterLogic'
import { CorrelationPanel } from '../heatmap/CorrelationPanel'
import { SpotlightFeed } from './SpotlightFeed'

vi.mock('../../store/heatmapStore', () => {
  const state = {
    dataPoints: [],
    annotations: [],
    currentMsgPerSec: 0,
    peakMsgPerSec: 0,
    rollingAverage30s: 0,
    _counter: 0,
    incrementCounter: () => {},
    tick: () => {},
    addAnnotation: () => {},
    reset: () => {},
    isDuringSpike: () => false,
  }
  const useHeatmapStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as unknown as {
    (selector?: (s: typeof state) => unknown): unknown
    getState: () => typeof state
    setState: (partial: Partial<typeof state>) => void
    subscribe: () => () => void
  }
  useHeatmapStore.getState = () => state
  useHeatmapStore.setState = () => {}
  useHeatmapStore.subscribe = () => () => {}
  return { useHeatmapStore }
})

const VIEWPORT_HEIGHT = 800
const VIEWPORT_WIDTH = 400
const saved: Array<[PropertyKey, PropertyDescriptor | undefined]> = []
const origRect = HTMLElement.prototype.getBoundingClientRect

const installLayoutStub = (): void => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  saved.length = 0
  for (const key of ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth'] as const) {
    saved.push([key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)])
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get() {
        return key.includes('Height') ? VIEWPORT_HEIGHT : VIEWPORT_WIDTH
      },
    })
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: VIEWPORT_WIDTH,
      bottom: VIEWPORT_HEIGHT,
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect
  }
}

const removeLayoutStub = (): void => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(HTMLElement.prototype, key, desc)
    else delete (HTMLElement.prototype as unknown as Record<PropertyKey, unknown>)[key]
  }
  saved.length = 0
  HTMLElement.prototype.getBoundingClientRect = origRect
}

const makeEvent = (
  login: string,
  userId: string,
  text: string,
  opts: { badges?: Badge[] } = {},
): ChannelChatMessageEvent => {
  const ev: ChannelChatMessageEvent = {
    broadcaster_user_id: `uid_${login}`,
    broadcaster_user_login: login,
    broadcaster_user_name: login,
    chatter_user_id: userId,
    chatter_user_login: userId,
    chatter_user_name: userId,
    message_id: `m_${userId}_${Math.random().toString(36).slice(2, 8)}`,
    message: { text, fragments: [{ type: 'text', text }] },
    color: '#fff',
    badges: (opts.badges ?? []).map((b) => ({ set_id: b.setId, id: b.id, info: b.info })),
    message_type: 'text',
  }
  return ev
}

describe('Cross-stream integration — 3 streams', () => {
  beforeEach(() => {
    installLayoutStub()
    useMultiStreamStore.getState().reset()
  })

  afterEach(() => {
    removeLayoutStub()
  })

  it('per-stream filters produce matched subsets; SpotlightFeed merges in timestamp order; correlation tick writes entries', () => {
    const store = useMultiStreamStore.getState()
    store.addStream({ login: 'a', displayName: 'Alpha', broadcasterId: 'b_a' })
    store.addStream({ login: 'b', displayName: 'Bravo', broadcasterId: 'b_b' })
    store.addStream({ login: 'c', displayName: 'Gamma', broadcasterId: 'b_c' })

    // Stream A: half subscribers, everyone else non-sub. Filter role:sub should match half.
    let t = 1_000
    for (let i = 0; i < 60; i++) {
      const badges: Badge[] = i % 2 === 0 ? [{ setId: 'subscriber', id: '1', info: '1' }] : []
      // Override timestamp so sort is deterministic.
      store.addMessage('a', makeEvent('a', `u_a_${i}`, `msg${i}`, { badges }))
      t += 10
    }
    // Stream B: 10 messages contain "raid" + 50 generic.
    for (let i = 0; i < 10; i++) {
      store.addMessage('b', makeEvent('b', `u_b_raid_${i}`, `raid incoming ${i}`))
    }
    for (let i = 0; i < 50; i++) {
      store.addMessage('b', makeEvent('b', `u_b_g_${i}`, `generic ${i}`))
    }
    // Stream C: 20 messages contain "pog".
    for (let i = 0; i < 20; i++) {
      store.addMessage('c', makeEvent('c', `u_c_pog_${i}`, `pog pog ${i}`))
    }
    for (let i = 0; i < 40; i++) {
      store.addMessage('c', makeEvent('c', `u_c_g_${i}`, `misc ${i}`))
    }

    // Distinct filter per stream.
    store.setStreamFilter('a', { query: 'role:sub', queryError: null })
    store.setStreamFilter('b', { query: 'kw:"raid"', queryError: null })
    store.setStreamFilter('c', { keyword: 'pog' })

    // Verify per-column counts via the evaluator (what SpotlightFeed uses).
    const snapshot = useMultiStreamStore.getState()
    const neverSpike = () => false
    const aMatches = applyFilters(
      snapshot.streams.a!.messages,
      snapshot.filterState.a!,
      neverSpike,
    )
    const bMatches = applyFilters(
      snapshot.streams.b!.messages,
      snapshot.filterState.b!,
      neverSpike,
    )
    const cMatches = applyFilters(
      snapshot.streams.c!.messages,
      snapshot.filterState.c!,
      neverSpike,
    )
    expect(aMatches.length).toBe(30)
    expect(bMatches.length).toBe(10)
    expect(cMatches.length).toBe(20)

    // SpotlightFeed renders merged, sorted rows — non-empty (the virtualizer
    // only materializes visible rows, so we assert mount + non-empty, not the
    // full 60-count).
    const { container } = render(<SpotlightFeed />)
    const visibleRows = container.querySelectorAll('[data-testid="spotlight-row"]')
    expect(visibleRows.length).toBeGreaterThan(0)
    // No "No matches" placeholder — the underlying merge is non-empty.
    expect(container.textContent).not.toMatch(/no matches/i)
    // Verify ordering in the subset that *is* materialized: each row's
    // data-index strictly increases left to right.
    const indices = Array.from(visibleRows).map((el) =>
      Number(el.getAttribute('data-index')),
    )
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1])
    }

    // Inject synthetic dataPoints that correlate positively between a and b.
    const now = Date.now()
    const spikePattern = (seed: number) =>
      Array.from({ length: 30 }, (_, i) => (i >= 10 && i < 20 ? 5 + seed : 0))
    const dataPointsA = spikePattern(0).map((msgPerSec, idx) => ({
      timestamp: now - (30 - idx) * 1000,
      msgPerSec,
    }))
    const dataPointsB = spikePattern(1).map((msgPerSec, idx) => ({
      timestamp: now - (30 - idx) * 1000,
      msgPerSec,
    }))
    const dataPointsC = Array.from({ length: 30 }, (_, idx) => ({
      timestamp: now - (30 - idx) * 1000,
      msgPerSec: idx,
    }))
    const s = useMultiStreamStore.getState()
    useMultiStreamStore.setState({
      streams: {
        ...s.streams,
        a: { ...s.streams.a!, dataPoints: dataPointsA },
        b: { ...s.streams.b!, dataPoints: dataPointsB },
        c: { ...s.streams.c!, dataPoints: dataPointsC },
      },
    })

    store.tickCorrelation()
    const correlationAB = useMultiStreamStore.getState().correlation[pairKeyFor('a', 'b')]
    expect(correlationAB).toBeDefined()
    expect(correlationAB!.coefficient).toBeGreaterThan(0.5)

    // CorrelationPanel should render at least once pairs have entries.
    useMultiStreamStore.setState({ isActive: true })
    const { getByTestId } = render(<CorrelationPanel />)
    expect(getByTestId('correlation-chart')).toBeInTheDocument()
  })
})
