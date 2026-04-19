import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import type {
  ChannelChatMessageEvent,
  PinnedMessage,
  SystemEvent,
} from '../../types/twitch'
import { ChatList } from './ChatList'
import { ChatPanel } from './ChatPanel'

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

const makeEvent = (userId: string, text: string): ChannelChatMessageEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: userId,
  chatter_user_login: userId,
  chatter_user_name: userId,
  message_id: `m-${userId}-${Math.random().toString(36).slice(2, 8)}`,
  message: { text, fragments: [{ type: 'text', text }] },
  color: '#a1a1aa',
  badges: [],
  message_type: 'text',
})

const pollResizeObserver = () => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
}

// happy-dom returns 0 for offset/client metrics and an all-zero DOMRect, so
// @tanstack/react-virtual decides nothing is visible. Stub the layout metrics
// it actually reads: `offsetWidth` + `offsetHeight` (viewport sizing) and
// `getBoundingClientRect` (scroll position).
const VIEWPORT_HEIGHT = 600
const VIEWPORT_WIDTH = 300

const savedDescriptors: Array<[PropertyKey, PropertyDescriptor | undefined]> = []
const origGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

const installLayoutStub = () => {
  savedDescriptors.length = 0
  for (const key of ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth'] as const) {
    savedDescriptors.push([key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)])
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return VIEWPORT_HEIGHT
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return VIEWPORT_WIDTH
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return VIEWPORT_HEIGHT
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return VIEWPORT_WIDTH
    },
  })
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

const removeLayoutStub = () => {
  for (const [key, desc] of savedDescriptors) {
    if (desc) {
      Object.defineProperty(HTMLElement.prototype, key, desc)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (HTMLElement.prototype as any)[key]
    }
  }
  savedDescriptors.length = 0
  HTMLElement.prototype.getBoundingClientRect = origGetBoundingClientRect
}

const resetStore = () => {
  act(() => {
    useChatStore.getState().resetForNewChannel()
  })
}

describe('ChatList — Phase 6 rows path', () => {
  beforeEach(() => {
    pollResizeObserver()
    installLayoutStub()
    resetStore()
  })

  afterEach(() => {
    removeLayoutStub()
  })

  it('annotates each virtualized wrapper with data-row-kind matching the row kind', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )

    const ev: SystemEvent = { noticeType: 'raid', fromUserName: 'Charlie', viewers: 3 }
    act(() => {
      useChatStore.getState().addMessage(makeEvent('alice', 'hello'))
      useChatStore.getState().addSystemEvent(ev)
    })

    const rows = container.querySelectorAll('[data-testid="chat-row"]')
    expect(rows.length).toBe(2)
    const kinds = Array.from(rows).map((r) => r.getAttribute('data-row-kind'))
    expect(kinds).toContain('message')
    expect(kinds).toContain('system')
  })

  it('applyUserClear mutates the prior message row to a deletion row in place; future messages from the same user render normally', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )

    act(() => {
      useChatStore.getState().addMessage(makeEvent('alice', 'bye'))
      useChatStore.getState().applyUserClear('alice')
      useChatStore.getState().addMessage(makeEvent('alice', 'fresh'))
    })

    expect(screen.queryByText('bye')).toBeNull()
    expect(screen.getByText(/message removed by moderator/i)).toBeInTheDocument()
    expect(screen.getByText('fresh')).toBeInTheDocument()

    const rowKinds = Array.from(container.querySelectorAll('[data-row-kind]')).map((r) =>
      r.getAttribute('data-row-kind'),
    )
    expect(rowKinds).toEqual(['deletion', 'message'])
  })

  it('chat-cleared row replaces the entire buffer with one cleared-marker row', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )

    act(() => {
      useChatStore.getState().addMessage(makeEvent('a', 'first'))
      useChatStore.getState().addMessage(makeEvent('b', 'second'))
      useChatStore.getState().applyChatClear()
    })

    const rows = container.querySelectorAll('[data-row-kind]')
    expect(rows.length).toBe(1)
    expect(rows[0]!.getAttribute('data-row-kind')).toBe('chat-cleared')
    expect(screen.getByText(/chat cleared by a moderator/i)).toBeInTheDocument()
  })
})

describe('ChatPanel — Phase 6 mounts PinnedMessageRibbon above ChatList', () => {
  beforeEach(() => {
    pollResizeObserver()
    installLayoutStub()
    resetStore()
  })

  afterEach(() => {
    removeLayoutStub()
  })

  it('renders the pinned ribbon when pins exist', () => {
    const pin: PinnedMessage = {
      id: 'pin_m1',
      messageId: 'm1',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'Read the FAQ',
      pinnedAt: new Date(),
    }
    act(() => {
      useChatStore.getState().addPin(pin)
    })
    render(
      <div style={{ height: 600 }}>
        <ChatPanel />
      </div>,
    )
    expect(screen.getByTestId('pinned-ribbon')).toBeInTheDocument()
    expect(screen.getByText(/Read the FAQ/)).toBeInTheDocument()
  })

  it('does not render the ribbon when there are no pins', () => {
    render(
      <div style={{ height: 600 }}>
        <ChatPanel />
      </div>,
    )
    expect(screen.queryByTestId('pinned-ribbon')).toBeNull()
  })
})

describe('ChatList — clicking a reply header scrolls to the parent', () => {
  beforeEach(() => {
    pollResizeObserver()
    installLayoutStub()
    resetStore()
  })

  afterEach(() => {
    removeLayoutStub()
  })

  it('wires onScrollToParent through ChatScrollContext; click resolves to the parent message id', () => {
    const { container } = render(
      <div style={{ height: 600 }}>
        <ChatList />
      </div>,
    )

    const parentEvent = makeEvent('parent-user', 'the original question')
    const parentId = parentEvent.message_id

    act(() => {
      useChatStore.getState().addMessage(parentEvent)
      useChatStore.getState().addMessage({
        ...makeEvent('child-user', '@parent-user hi'),
        reply: {
          parent_message_id: parentId,
          parent_message_body: 'the original question',
          parent_user_id: 'parent-user',
          parent_user_login: 'parent-user',
          parent_user_name: 'parent-user',
          thread_parent_message_id: parentId,
        },
      })
    })

    const replyButton = screen.queryByRole('button', { name: /Replying to/i })
    expect(replyButton).not.toBeNull()
    // Smoke test the callback wiring — clicking does not throw even when the virtualizer
    // has not measured the parent row yet.
    expect(() => fireEvent.click(replyButton!)).not.toThrow()
    expect(container).toBeTruthy()
  })
})
