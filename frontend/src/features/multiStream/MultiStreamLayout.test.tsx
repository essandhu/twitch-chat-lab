import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type { ChatMessage } from '../../types/twitch'
import { MultiStreamLayout } from './MultiStreamLayout'

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
})

describe('MultiStreamLayout', () => {
  beforeEach(() => {
    useMultiStreamStore.getState().reset()
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
  })

  it('renders one column per entry in multiStreamStore.order', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })
    s.addStream({ login: 'carol', displayName: 'Carol', broadcasterId: 'b_carol' })

    const { container, getByText } = render(
      <div style={{ height: 600 }}>
        <MultiStreamLayout />
      </div>,
    )

    expect(getByText('Alice')).toBeInTheDocument()
    expect(getByText('Bob')).toBeInTheDocument()
    expect(getByText('Carol')).toBeInTheDocument()

    // Close buttons are a reliable per-column signal (there is exactly one per slice).
    const closeButtons = container.querySelectorAll('button[aria-label^="Close "]')
    expect(closeButtons).toHaveLength(3)
  })

  it('wires each slice.messages into its own ChatList (messagesOverride pathway)', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })

    // Seed each slice with a distinct number of messages.
    useMultiStreamStore.setState((state) => ({
      streams: {
        ...state.streams,
        alice: {
          ...state.streams.alice!,
          messages: [makeMessage('a1', 'from alice 1'), makeMessage('a2', 'from alice 2')],
        },
        bob: {
          ...state.streams.bob!,
          messages: [
            makeMessage('b1', 'from bob 1'),
            makeMessage('b2', 'from bob 2'),
            makeMessage('b3', 'from bob 3'),
          ],
        },
      },
    }))

    const { container } = render(
      <div style={{ height: 600 }}>
        <MultiStreamLayout />
      </div>,
    )

    // Each ChatList produces an inner `.overflow-y-auto > div` sized by
    // messages.length * 40px estimate. Two distinct heights prove per-slice wiring.
    const innerHeights = Array.from(
      container.querySelectorAll('.overflow-y-auto > div'),
    ).map((el) => (el as HTMLElement).style.height)
    expect(innerHeights).toContain('80px') // alice: 2 × 40
    expect(innerHeights).toContain('120px') // bob: 3 × 40
  })

  it('shows the "Connection lost" banner on a degraded slice', () => {
    const s = useMultiStreamStore.getState()
    s.addStream({ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' })
    s.addStream({ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' })
    s.setDegraded('alice', true)

    const { getAllByRole, queryByText } = render(
      <div style={{ height: 600 }}>
        <MultiStreamLayout />
      </div>,
    )

    const alerts = getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.textContent).toMatch(/connection lost/i)
    // Sanity — the phrase doesn't leak elsewhere when the opposite slice is healthy.
    expect(queryByText(/connection lost/i, { selector: 'button' })).not.toBeInTheDocument()
  })
})
