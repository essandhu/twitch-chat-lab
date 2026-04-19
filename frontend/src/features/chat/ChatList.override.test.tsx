import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import { ChatList } from './ChatList'
import type { ChatMessage } from '../../types/twitch'

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

const makeMessage = (id: string, text: string): ChatMessage => ({
  id,
  userId: `u-${id}`,
  userLogin: `user-${id}`,
  displayName: `User ${id}`,
  color: '#a1a1aa',
  badges: [],
  fragments: [{ type: 'text', text }],
  text,
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(),
  messageType: 'text',
})

const seedStoreMessage = (text: string) => {
  const msg = makeMessage('store', text)
  useChatStore.setState({
    messages: [msg],
    rows: [{ kind: 'message', id: msg.id, message: msg }],
    messagesById: { [msg.id]: msg },
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
}

describe('ChatList messagesOverride prop', () => {
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
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
  })

  it('sizes the virtualized list from messagesOverride instead of the store', () => {
    // Seed store with 1 message; pass override of 4. Virtualizer sizes the
    // inner content area by count * estimateSize (40 px). Asserting the
    // override count drives layout confirms the override is what the list uses.
    seedStoreMessage('from store — should NOT be counted')
    const override: ChatMessage[] = [
      makeMessage('a', 'override message A'),
      makeMessage('b', 'override message B'),
      makeMessage('c', 'override message C'),
      makeMessage('d', 'override message D'),
    ]

    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList messagesOverride={override} />
      </div>,
    )

    const inner = container.querySelector('.overflow-y-auto > div') as HTMLElement
    expect(inner).not.toBeNull()
    // Per-kind size from P6-12: message → 28 px; 4 rows × 28 = 112 px.
    expect(inner.style.height).toBe('112px')
  })

  it('falls back to the store when messagesOverride is not provided', () => {
    seedStoreMessage('from store — should be counted')

    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )

    const inner = container.querySelector('.overflow-y-auto > div') as HTMLElement
    expect(inner).not.toBeNull()
    // Per-kind size from P6-12: message → 28 px.
    expect(inner.style.height).toBe('28px')
  })
})
