import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../types/twitch'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { SpotlightFeed } from './SpotlightFeed'

const VIEWPORT_HEIGHT = 600
const VIEWPORT_WIDTH = 400
const saved: Array<[PropertyKey, PropertyDescriptor | undefined]> = []
const origRect = HTMLElement.prototype.getBoundingClientRect

const installLayoutStub = (): void => {
  saved.length = 0
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
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

const mkMsg = (id: string, text: string, ts: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  userId: `u_${id}`,
  userLogin: `user_${id}`,
  displayName: `User${id}`,
  color: '#fff',
  badges: [],
  fragments: [{ type: 'text', text }],
  text,
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(ts),
  messageType: 'text',
  ...overrides,
})

const pushMessage = (login: string, msg: ChatMessage): void => {
  const state = useMultiStreamStore.getState()
  const slice = state.streams[login]
  if (!slice) throw new Error(`no slice ${login}`)
  useMultiStreamStore.setState({
    streams: {
      ...state.streams,
      [login]: { ...slice, messages: [...slice.messages, msg] },
    },
  })
}

describe('SpotlightFeed', () => {
  beforeEach(() => {
    installLayoutStub()
    useMultiStreamStore.getState().reset()
  })

  afterEach(() => {
    removeLayoutStub()
  })

  it('renders placeholder when no streams match', () => {
    render(<SpotlightFeed />)
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it('merges messages from 2 streams in timestamp order', () => {
    useMultiStreamStore.getState().addStream({
      login: 'alice',
      displayName: 'Alice',
      broadcasterId: 'b_a',
    })
    useMultiStreamStore.getState().addStream({
      login: 'bob',
      displayName: 'Bob',
      broadcasterId: 'b_b',
    })
    pushMessage('alice', mkMsg('a1', 'hello', 1000))
    pushMessage('bob', mkMsg('b1', 'world', 500))
    pushMessage('alice', mkMsg('a2', 'third', 2000))

    const { container } = render(<SpotlightFeed />)
    const rows = container.querySelectorAll('[data-testid="spotlight-row"]')
    expect(rows.length).toBe(3)
    // Timestamps 500, 1000, 2000 → bob, alice a1, alice a2
    expect(rows[0].textContent).toContain('Bob')
    expect(rows[1].textContent).toContain('Alice')
    expect(rows[2].textContent).toContain('Alice')
  })

  it('applies per-stream filter query', () => {
    useMultiStreamStore.getState().addStream({
      login: 'alice',
      displayName: 'Alice',
      broadcasterId: 'b_a',
    })
    useMultiStreamStore.getState().addStream({
      login: 'bob',
      displayName: 'Bob',
      broadcasterId: 'b_b',
    })
    pushMessage('alice', mkMsg('a1', 'pog', 1000))
    pushMessage('alice', mkMsg('a2', 'meh', 1500))
    pushMessage('bob', mkMsg('b1', 'pog', 2000))
    useMultiStreamStore.getState().setStreamFilter('alice', { query: 'kw:"pog"', queryError: null })

    const { container } = render(<SpotlightFeed />)
    const rows = container.querySelectorAll('[data-testid="spotlight-row"]')
    // alice: filters to only 'pog' (a1); bob: no filter → both b1 passes. a2 filtered out.
    expect(rows.length).toBe(2)
  })

  it('renders source badge with the stream displayName', () => {
    useMultiStreamStore.getState().addStream({
      login: 'alice',
      displayName: 'AliceDisplay',
      broadcasterId: 'b_a',
    })
    pushMessage('alice', mkMsg('a1', 'hello', 100))

    const { container } = render(<SpotlightFeed />)
    const rows = container.querySelectorAll('[data-testid="spotlight-row"]')
    expect(rows[0].textContent).toContain('AliceDisplay')
  })
})
