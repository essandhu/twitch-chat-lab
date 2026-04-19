import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatRow, SystemEvent } from '../../types/twitch'
import { ChatRowRenderer } from './ChatRowRenderer'

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
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

describe('ChatRowRenderer', () => {
  it('kind:"message" — renders the ChatMessage author + text', () => {
    const row: ChatRow = { kind: 'message', id: 'm1', message: makeMessage() }
    render(<ChatRowRenderer row={row} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('hi there')).toBeInTheDocument()
  })

  it('kind:"system" — renders the SystemEventRow branch', () => {
    const event: SystemEvent = { noticeType: 'raid', fromUserName: 'Charlie', viewers: 7 }
    const row: ChatRow = { kind: 'system', id: 'sys1', event, timestamp: new Date() }
    render(<ChatRowRenderer row={row} />)
    expect(screen.getByText(/Charlie/)).toBeInTheDocument()
    expect(screen.getByText(/raided with 7 viewers/i)).toBeInTheDocument()
  })

  it('kind:"deletion" — renders DeletionMarker (no author)', () => {
    const row: ChatRow = {
      kind: 'deletion',
      id: 'del1',
      messageId: 'm1',
      deletedAt: new Date(),
    }
    render(<ChatRowRenderer row={row} />)
    expect(screen.getByText(/message removed by moderator/i)).toBeInTheDocument()
  })

  it('kind:"chat-cleared" — renders the "Chat cleared by a moderator" line', () => {
    const row: ChatRow = { kind: 'chat-cleared', id: 'clr1', clearedAt: new Date() }
    render(<ChatRowRenderer row={row} />)
    expect(screen.getByText(/chat cleared by a moderator/i)).toBeInTheDocument()
  })
})
