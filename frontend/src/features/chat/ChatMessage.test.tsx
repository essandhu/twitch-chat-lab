import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import type { ChatMessage as ChatMessageData } from '../../types/twitch'
import { ChatMessage } from './ChatMessage'

const base = (overrides: Partial<ChatMessageData> = {}): ChatMessageData => ({
  id: 'm1',
  userId: 'u1',
  userLogin: 'alice',
  displayName: 'Alice',
  color: '#ffffff',
  badges: [],
  fragments: [{ type: 'text', text: 'hi there' }],
  text: 'hi there',
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(),
  messageType: 'text',
  ...overrides,
})

describe('ChatMessage', () => {
  beforeEach(() => {
    act(() => {
      useChatStore.getState().resetForNewChannel()
    })
  })

  it('renders a plain message without Phase 6 extras', () => {
    render(<ChatMessage message={base()} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('hi there')).toBeInTheDocument()
    expect(screen.queryByText(/Replying to/i)).toBeNull()
    expect(screen.queryByText(/cheered/i)).toBeNull()
  })

  it('renders the ReplyHeader when message.reply is present and parent is in buffer', () => {
    act(() => {
      useChatStore.setState({
        messagesById: {
          pm1: base({
            id: 'pm1',
            userId: 'pu1',
            displayName: 'Parent',
            text: 'what time is stream?',
          }),
        },
      })
    })
    render(
      <ChatMessage
        message={base({
          reply: {
            parentMessageId: 'pm1',
            parentUserLogin: 'alice',
            parentUserName: 'Alice',
            parentMessageText: 'what time is stream?',
            threadParentMessageId: 'pm1',
          },
        })}
      />,
    )
    expect(screen.getByText(/Replying to/)).toBeInTheDocument()
  })

  it('renders the CheerPill when message.cheer is present', () => {
    render(<ChatMessage message={base({ cheer: { bits: 500 }, text: 'cheer500' })} />)
    expect(screen.getByText(/cheered 500 bits/i)).toBeInTheDocument()
  })

  it('applies channel_points_sub_only variant class', () => {
    const { container } = render(
      <ChatMessage message={base({ messageType: 'channel_points_sub_only' })} />,
    )
    const row = container.firstChild as HTMLElement
    expect(row.className).toMatch(/border-l-2/)
    expect(row.className).toMatch(/ember/)
  })

  it('applies user_intro variant class and renders the intro badge', () => {
    const { container } = render(
      <ChatMessage message={base({ messageType: 'user_intro' })} />,
    )
    const row = container.firstChild as HTMLElement
    expect(row.className).toMatch(/ember-500\/5/)
    expect(screen.getByText(/intro/i)).toBeInTheDocument()
  })

  it('applies the existing isHighlighted class for channel_points_highlighted', () => {
    const { container } = render(
      <ChatMessage
        message={base({ isHighlighted: true, messageType: 'channel_points_highlighted' })}
      />,
    )
    const row = container.firstChild as HTMLElement
    expect(row.className).toMatch(/ink-700/)
  })
})
