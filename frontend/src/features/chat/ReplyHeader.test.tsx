import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import type { ChatMessage, ChatMessageReply } from '../../types/twitch'
import { ReplyHeader } from './ReplyHeader'

const reply: ChatMessageReply = {
  parentMessageId: 'pm1',
  parentUserLogin: 'alice',
  parentUserName: 'Alice',
  parentMessageText: 'what time is stream?',
  threadParentMessageId: 'pm1',
}

const parentMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'pm1',
  userId: 'pu1',
  userLogin: 'alice',
  displayName: 'Alice',
  color: '#ffffff',
  badges: [],
  fragments: [{ type: 'text', text: 'what time is stream?' }],
  text: 'what time is stream?',
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(),
  messageType: 'text',
  ...overrides,
})

const seedParent = (parent: ChatMessage | null) => {
  act(() => {
    useChatStore.setState({
      messagesById: parent ? { [parent.id]: parent } : {},
    })
  })
}

describe('ReplyHeader', () => {
  beforeEach(() => {
    act(() => {
      useChatStore.getState().resetForNewChannel()
    })
  })

  it('renders "Replying to @parent" with a preview when parent is in buffer and not redacted', () => {
    seedParent(parentMessage())
    const onScroll = vi.fn()
    render(<ReplyHeader reply={reply} onScrollToParent={onScroll} />)
    expect(screen.getByText(/Replying to/i)).toBeInTheDocument()
    expect(screen.getByText(/@Alice/)).toBeInTheDocument()
    expect(screen.getByText(/what time is stream/i)).toBeInTheDocument()
  })

  it('is a button that fires onScrollToParent(parentMessageId) on click when parent is resolvable', () => {
    seedParent(parentMessage())
    const onScroll = vi.fn()
    render(<ReplyHeader reply={reply} onScrollToParent={onScroll} />)
    const btn = screen.getByRole('button', { name: /Replying to/i })
    fireEvent.click(btn)
    expect(onScroll).toHaveBeenCalledWith('pm1')
  })

  it('renders "no longer available" when parent has been evicted from messagesById', () => {
    seedParent(null)
    render(<ReplyHeader reply={reply} onScrollToParent={() => {}} />)
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders "no longer available" after applyUserClear removes the parent from messagesById', () => {
    seedParent(parentMessage({ userId: 'pu1' }))
    // Simulate applyUserClear's net effect on messagesById: the parent's entry
    // is deleted alongside its row mutation. After that, ReplyHeader sees the
    // parent as missing and shows the unavailable label.
    act(() => {
      useChatStore.setState({ messagesById: {} })
    })
    render(<ReplyHeader reply={reply} onScrollToParent={() => {}} />)
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('truncates parent text at 60 chars with an ellipsis', () => {
    const longText = 'a'.repeat(80)
    seedParent(parentMessage({ text: longText }))
    render(
      <ReplyHeader
        reply={{ ...reply, parentMessageText: longText }}
        onScrollToParent={() => {}}
      />,
    )
    const truncated = 'a'.repeat(60) + '…'
    expect(screen.getByText(new RegExp(truncated))).toBeInTheDocument()
  })

  it('does not truncate parent text under 60 chars', () => {
    seedParent(parentMessage({ text: 'short msg' }))
    render(
      <ReplyHeader
        reply={{ ...reply, parentMessageText: 'short msg' }}
        onScrollToParent={() => {}}
      />,
    )
    expect(screen.getByText(/short msg(?!…)/)).toBeInTheDocument()
  })
})
