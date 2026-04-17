import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import { ChatPanel } from './ChatPanel'
import type { ChannelChatMessageEvent } from '../../types/twitch'

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

const DISTINCT_USERS = 200
const TOTAL_MESSAGES = 10_000
const BATCH_SIZE = 100
const BUFFER_CAP = 5_000

const makeEvent = (idx: number, userIdx: number): ChannelChatMessageEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: `user-${userIdx}`,
  chatter_user_login: `user${userIdx}`,
  chatter_user_name: `User${userIdx}`,
  message_id: `m-${idx}`,
  message: {
    text: `message ${idx}`,
    fragments: [{ type: 'text', text: `message ${idx}` }],
  },
  color: '#a1a1aa',
  badges: [],
  message_type: 'text',
})

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx] ?? 0
}

describe('ChatPanel throughput', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      firstTimers: [],
      seenUserIds: new Set<string>(),
      badgeDefinitions: {},
      filterState: {
        firstTimeOnly: false,
        subscribersOnly: false,
        keyword: '',
        hypeModeOnly: false,
      },
    })
    performance.clearMarks()
    performance.clearMeasures()
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
  })

  afterEach(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  it(
    'sustains 10,000 messages with bounded DOM, saturated buffer, and per-frame render under 16 ms',
    () => {
      const { container } = render(
        <div style={{ height: 600 }}>
          <ChatPanel />
        </div>,
      )

      const durations: number[] = []
      const { addMessage } = useChatStore.getState()

      for (let batch = 0; batch < TOTAL_MESSAGES / BATCH_SIZE; batch++) {
        act(() => {
          for (let i = 0; i < BATCH_SIZE; i++) {
            const idx = batch * BATCH_SIZE + i
            addMessage(makeEvent(idx, idx % DISTINCT_USERS))
          }
        })
        const entries = performance.getEntriesByName('virt')
        const last = entries[entries.length - 1]
        if (last) durations.push(last.duration)
      }

      expect(useChatStore.getState().messages.length).toBe(BUFFER_CAP)

      const nodes = container.querySelectorAll('[data-index]')
      expect(nodes.length).toBeLessThanOrEqual(60)

      expect(durations.length).toBeGreaterThan(0)
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length
      expect(avg).toBeLessThan(16)
      expect(percentile(durations, 0.95)).toBeLessThanOrEqual(16)
    },
    { timeout: 30_000 },
  )
})
