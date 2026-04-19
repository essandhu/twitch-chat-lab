import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import type { PinnedMessage } from '../../types/twitch'
import { PinnedMessageRibbon } from './PinnedMessageRibbon'

const pin = (messageId: string, text: string, userName = 'Mod'): PinnedMessage => ({
  id: `pin_${messageId}`,
  messageId,
  userLogin: userName.toLowerCase(),
  userName,
  text,
  pinnedAt: new Date(),
})

describe('PinnedMessageRibbon', () => {
  beforeEach(() => {
    act(() => {
      useChatStore.getState().resetForNewChannel()
    })
  })

  it('returns null when there are no pinned messages', () => {
    const { container } = render(<PinnedMessageRibbon />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a single pin with pinner name and text', () => {
    act(() => {
      useChatStore.getState().addPin(pin('m1', 'Read the FAQ'))
    })
    render(<PinnedMessageRibbon />)
    expect(screen.getByText(/Read the FAQ/)).toBeInTheDocument()
    expect(screen.getByText(/Mod/)).toBeInTheDocument()
  })

  it('renders up to 3 pins visibly without an overflow chevron', () => {
    act(() => {
      const s = useChatStore.getState()
      s.addPin(pin('m3', 'third'))
      s.addPin(pin('m2', 'second'))
      s.addPin(pin('m1', 'first'))
    })
    render(<PinnedMessageRibbon />)
    expect(screen.getByText(/first/)).toBeInTheDocument()
    expect(screen.getByText(/second/)).toBeInTheDocument()
    expect(screen.getByText(/third/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more/i })).toBeNull()
  })

  it('collapses a 4th pin under a "+1 more" chevron', () => {
    act(() => {
      const s = useChatStore.getState()
      s.addPin(pin('m4', 'fourth'))
      s.addPin(pin('m3', 'third'))
      s.addPin(pin('m2', 'second'))
      s.addPin(pin('m1', 'first'))
    })
    render(<PinnedMessageRibbon />)
    // Newest 3 are visible (m1 first, m2, m3); m4 is hidden under the chevron.
    expect(screen.getByText(/first/)).toBeInTheDocument()
    expect(screen.getByText(/second/)).toBeInTheDocument()
    expect(screen.getByText(/third/)).toBeInTheDocument()
    expect(screen.queryByText(/fourth/)).toBeNull()
    expect(screen.getByRole('button', { name: /\+1 more/i })).toBeInTheDocument()
  })

  it('toggles the overflow dropdown open and closed when the chevron is clicked', () => {
    act(() => {
      const s = useChatStore.getState()
      s.addPin(pin('m4', 'fourth-hidden'))
      s.addPin(pin('m3', 'third'))
      s.addPin(pin('m2', 'second'))
      s.addPin(pin('m1', 'first'))
    })
    render(<PinnedMessageRibbon />)
    const chevron = screen.getByRole('button', { name: /\+1 more/i })
    fireEvent.click(chevron)
    expect(screen.getByText(/fourth-hidden/)).toBeInTheDocument()
    fireEvent.click(chevron)
    expect(screen.queryByText(/fourth-hidden/)).toBeNull()
  })
})
