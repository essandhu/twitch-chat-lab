import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import { ChatList } from './ChatList'
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

const makeEvent = (idx: number): ChannelChatMessageEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: `user-${idx}`,
  chatter_user_login: `user${idx}`,
  chatter_user_name: `User${idx}`,
  message_id: `m-${idx}`,
  message: {
    text: `message ${idx}`,
    fragments: [{ type: 'text', text: `message ${idx}` }],
  },
  color: '#a1a1aa',
  badges: [],
  message_type: 'text',
})

const stubScrollMetrics = (
  el: HTMLElement,
  { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number },
) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true })
}

const seedMessages = (count: number) => {
  const { addMessage } = useChatStore.getState()
  act(() => {
    for (let i = 0; i < count; i++) addMessage(makeEvent(i))
  })
}

describe('ChatList auto-scroll', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      firstTimers: [],
      seenUserIds: new Set<string>(),
      badgeDefinitions: {},
      filterState: { firstTimeOnly: false, subscribersOnly: false, keyword: '', hypeModeOnly: false },
    })
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
  })

  it('hides the jump-to-latest button while pinned to the bottom', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )
    seedMessages(5)

    const scrollable = container.querySelector('.overflow-y-auto') as HTMLElement
    stubScrollMetrics(scrollable, { scrollHeight: 500, clientHeight: 300, scrollTop: 150 })
    // distance = 500 - (150 + 300) = 50 ≤ 100 → auto-scroll stays enabled
    fireEvent.scroll(scrollable)

    expect(screen.queryByLabelText('Scroll to latest message')).toBeNull()
  })

  it('reveals the jump-to-latest button when scrolled more than 100 px above the bottom', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )
    seedMessages(5)

    const scrollable = container.querySelector('.overflow-y-auto') as HTMLElement
    expect(scrollable).not.toBeNull()
    stubScrollMetrics(scrollable, { scrollHeight: 500, clientHeight: 300, scrollTop: 0 })
    // distance = 500 - (0 + 300) = 200 > 100 → auto-scroll disabled
    fireEvent.scroll(scrollable)

    const button = screen.getByLabelText('Scroll to latest message')
    expect(button).toBeInTheDocument()
    expect(button.textContent).toContain('Jump to latest')
  })

  it('re-enables auto-scroll when the jump-to-latest button is clicked', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )
    seedMessages(5)

    const scrollable = container.querySelector('.overflow-y-auto') as HTMLElement
    stubScrollMetrics(scrollable, { scrollHeight: 500, clientHeight: 300, scrollTop: 0 })
    fireEvent.scroll(scrollable)

    const button = screen.getByLabelText('Scroll to latest message')
    act(() => {
      fireEvent.click(button)
    })

    expect(screen.queryByLabelText('Scroll to latest message')).toBeNull()
  })
})
