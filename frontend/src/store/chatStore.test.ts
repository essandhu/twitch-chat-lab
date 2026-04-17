import { beforeEach, describe, expect, it } from 'vitest'
import type { ChannelChatMessageEvent, StreamSession } from '../types/twitch'
import { useChatStore } from './chatStore'

const makeRawEvent = (
  userId: string,
  text: string,
  overrides: Partial<ChannelChatMessageEvent> = {},
): ChannelChatMessageEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: userId,
  chatter_user_login: `user_${userId}`,
  chatter_user_name: `User${userId}`,
  message_id: `m_${userId}_${text.slice(0, 5)}_${Math.random().toString(36).slice(2, 8)}`,
  message: {
    text,
    fragments: [{ type: 'text', text }],
  },
  color: '#ffffff',
  badges: [],
  message_type: 'text',
  ...overrides,
})

const fakeSession = (): StreamSession => ({
  broadcasterId: 'b1',
  broadcasterLogin: 'broadcaster',
  broadcasterDisplayName: 'Broadcaster',
  streamTitle: 'Title',
  gameName: 'Game',
  gameId: 'g1',
  viewerCount: 100,
  startedAt: new Date('2025-01-01T00:00:00Z'),
  isConnected: true,
})

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.getState().resetForNewChannel()
    useChatStore.setState({
      session: null,
      filterState: {
        firstTimeOnly: false,
        subscribersOnly: false,
        keyword: '',
        hypeModeOnly: false,
      },
      badgeDefinitions: {},
    })
  })

  it('first message from a user sets isFirstInSession and appends a FirstTimerEntry', () => {
    useChatStore.getState().addMessage(makeRawEvent('u1', 'hello'))
    const { messages, firstTimers, seenUserIds } = useChatStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.isFirstInSession).toBe(true)
    expect(firstTimers).toHaveLength(1)
    expect(firstTimers[0]?.userId).toBe('u1')
    expect(firstTimers[0]?.message).toBe('hello')
    expect(seenUserIds.has('u1')).toBe(true)
  })

  it('second message from the same user sets isFirstInSession=false and does not append to firstTimers', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    s.addMessage(makeRawEvent('u1', 'again'))
    const { messages, firstTimers } = useChatStore.getState()
    expect(messages).toHaveLength(2)
    expect(messages[1]?.isFirstInSession).toBe(false)
    expect(firstTimers).toHaveLength(1)
  })

  it('caps messages at 5,000 using a sliding window', () => {
    const s = useChatStore.getState()
    for (let i = 0; i < 5001; i += 1) {
      s.addMessage(makeRawEvent(`u${i}`, `msg ${i}`))
    }
    const { messages } = useChatStore.getState()
    expect(messages).toHaveLength(5000)
    expect(messages[0]?.text).toBe('msg 1')
    expect(messages[4999]?.text).toBe('msg 5000')
  })

  it('setFilterState merges partial updates without disturbing other fields', () => {
    const s = useChatStore.getState()
    s.setFilterState({ firstTimeOnly: true })
    expect(useChatStore.getState().filterState).toEqual({
      firstTimeOnly: true,
      subscribersOnly: false,
      keyword: '',
      hypeModeOnly: false,
    })
    s.setFilterState({ keyword: 'pog' })
    expect(useChatStore.getState().filterState).toEqual({
      firstTimeOnly: true,
      subscribersOnly: false,
      keyword: 'pog',
      hypeModeOnly: false,
    })
  })

  it('resetForNewChannel clears messages/seenUserIds/firstTimers and re-detects first-timers after reset', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'first'))
    s.resetForNewChannel()
    const cleared = useChatStore.getState()
    expect(cleared.messages).toHaveLength(0)
    expect(cleared.firstTimers).toHaveLength(0)
    expect(cleared.seenUserIds.size).toBe(0)

    cleared.addMessage(makeRawEvent('u1', 'second'))
    expect(useChatStore.getState().messages[0]?.isFirstInSession).toBe(true)
  })

  it('setSession(null) clears the session', () => {
    const s = useChatStore.getState()
    s.setSession(fakeSession())
    expect(useChatStore.getState().session).not.toBeNull()
    s.setSession(null)
    expect(useChatStore.getState().session).toBeNull()
  })

  it('normalizes raw snake_case badges to camelCase on the ChatMessage', () => {
    const s = useChatStore.getState()
    s.addMessage(
      makeRawEvent('u1', 'hi', {
        badges: [
          { set_id: 'subscriber', id: '12', info: '12' },
          { set_id: 'moderator', id: '1', info: '' },
        ],
      }),
    )
    const msg = useChatStore.getState().messages[0]
    expect(msg?.badges).toEqual([
      { setId: 'subscriber', id: '12', info: '12' },
      { setId: 'moderator', id: '1', info: '' },
    ])
  })

  it('normalizes fragments: text and emote variants', () => {
    const s = useChatStore.getState()
    s.addMessage(
      makeRawEvent('u1', 'Hello PogChamp', {
        message: {
          text: 'Hello PogChamp',
          fragments: [
            { type: 'text', text: 'Hello ' },
            { type: 'emote', text: 'PogChamp', emote: { id: '305954156' } },
          ],
        },
      }),
    )
    const frags = useChatStore.getState().messages[0]?.fragments
    expect(frags).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'emote', text: 'PogChamp', emote: { id: '305954156' } },
    ])
  })

  it('sets isHighlighted based on channel points message_type', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hi', { message_type: 'channel_points_highlighted' }))
    s.addMessage(makeRawEvent('u2', 'hi', { message_type: 'text' }))
    const { messages } = useChatStore.getState()
    expect(messages[0]?.isHighlighted).toBe(true)
    expect(messages[1]?.isHighlighted).toBe(false)
  })

  it('clearMessages empties messages but preserves seenUserIds and firstTimers', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'a'))
    s.addMessage(makeRawEvent('u2', 'b'))
    s.clearMessages()
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(0)
    expect(state.seenUserIds.size).toBe(2)
    expect(state.firstTimers).toHaveLength(2)
  })

  it('setBadgeDefinitions replaces the badge map', () => {
    const s = useChatStore.getState()
    s.setBadgeDefinitions({ subscriber: { '12': 'url-a' } })
    expect(useChatStore.getState().badgeDefinitions).toEqual({ subscriber: { '12': 'url-a' } })
  })
})
