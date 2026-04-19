import { beforeEach, describe, expect, it } from 'vitest'
import type { ChannelChatMessageEvent, PinnedMessage, StreamSession, SystemEvent } from '../types/twitch'
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

  // ---------------------------------------------------------------------------
  // Phase 6 — rows / messagesById / pinnedMessages / redactedUserIds + actions
  // ---------------------------------------------------------------------------

  it('addMessage also appends a kind:"message" row and indexes messagesById', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(1)
    const row = state.rows[0]!
    expect(row.kind).toBe('message')
    if (row.kind === 'message') {
      expect(row.id).toBe(row.message.id)
      expect(state.messagesById[row.message.id]).toEqual(row.message)
    }
  })

  it('rows[] caps at 5000 and messagesById entries are pruned as rows are evicted', () => {
    const s = useChatStore.getState()
    for (let i = 0; i < 5005; i += 1) {
      s.addMessage(makeRawEvent(`u${i}`, `msg ${i}`))
    }
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(5000)
    expect(Object.keys(state.messagesById)).toHaveLength(5000)
    // The first five messages should have been evicted along with their messagesById entries.
    const remainingIds = new Set(state.rows.map((r) => r.id))
    expect(remainingIds.size).toBe(5000)
  })

  it('addSystemEvent appends a kind:"system" row with id + timestamp', () => {
    const s = useChatStore.getState()
    const ev: SystemEvent = {
      noticeType: 'raid',
      fromUserName: 'Charlie',
      viewers: 42,
    }
    s.addSystemEvent(ev)
    const rows = useChatStore.getState().rows
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.kind).toBe('system')
    if (row.kind === 'system') {
      expect(row.event).toEqual(ev)
      expect(row.timestamp).toBeInstanceOf(Date)
      expect(typeof row.id).toBe('string')
      expect(row.id.length).toBeGreaterThan(0)
    }
  })

  it('addSystemEvent does NOT increment firstTimers or seenUserIds', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    const beforeSeen = useChatStore.getState().seenUserIds.size
    const beforeFirst = useChatStore.getState().firstTimers.length
    s.addSystemEvent({ noticeType: 'raid', fromUserName: 'X', viewers: 1 })
    expect(useChatStore.getState().seenUserIds.size).toBe(beforeSeen)
    expect(useChatStore.getState().firstTimers.length).toBe(beforeFirst)
  })

  it('applyDeletion replaces the matching message row with a kind:"deletion" row', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    s.addMessage(makeRawEvent('u2', 'world'))
    const rows0 = useChatStore.getState().rows
    const firstId = rows0[0]!.kind === 'message' ? rows0[0]!.message.id : ''
    s.applyDeletion(firstId)
    const rows1 = useChatStore.getState().rows
    expect(rows1).toHaveLength(2)
    expect(rows1[0]!.kind).toBe('deletion')
    if (rows1[0]!.kind === 'deletion') {
      expect(rows1[0]!.messageId).toBe(firstId)
    }
    // messagesById lookup for the deleted id goes away
    expect(useChatStore.getState().messagesById[firstId]).toBeUndefined()
    // shadow messages[] still reflects original order minus the deleted one
    // (we do NOT touch messages[] on deletion — the filter/first-timer derivation keys off it)
  })

  it('applyDeletion is a no-op when the messageId is not in the buffer', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    const before = useChatStore.getState().rows
    s.applyDeletion('nonexistent_id')
    expect(useChatStore.getState().rows).toEqual(before)
  })

  it('applyUserClear replaces prior message rows from the target user with deletion rows in place', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    s.addMessage(makeRawEvent('u2', 'other'))
    s.addMessage(makeRawEvent('u1', 'there'))
    s.applyUserClear('u1')
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(3)
    expect(state.rows[0]!.kind).toBe('deletion')
    expect(state.rows[1]!.kind).toBe('message') // u2's message untouched
    expect(state.rows[2]!.kind).toBe('deletion')
    // messagesById entries for u1's messages are gone; u2's stays.
    const ids = Object.keys(state.messagesById)
    expect(ids).toHaveLength(1)
    const remaining = state.messagesById[ids[0]!]!
    expect(remaining.userId).toBe('u2')
  })

  it('applyUserClear followed by a new message from the same user renders it as a fresh message row', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'before'))
    s.applyUserClear('u1')
    s.addMessage(makeRawEvent('u1', 'after'))
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(2)
    // Row 0 is a deletion marker (prior message), row 1 is the fresh message.
    expect(state.rows[0]!.kind).toBe('deletion')
    const last = state.rows[1]!
    expect(last.kind).toBe('message')
    if (last.kind === 'message') {
      expect(last.message.text).toBe('after')
    }
  })

  it('applyUserClear is a no-op when the target user has no messages in the buffer', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    const rowsBefore = useChatStore.getState().rows.slice()
    s.applyUserClear('u999')
    expect(useChatStore.getState().rows).toEqual(rowsBefore)
  })

  it('applyChatClear empties rows + messagesById + pinnedMessages and inserts a chat-cleared row', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    s.addMessage(makeRawEvent('u2', 'world'))
    s.addPin({
      id: 'pin_m1',
      messageId: 'm1',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'rules',
      pinnedAt: new Date(),
    })
    s.applyChatClear()
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]!.kind).toBe('chat-cleared')
    expect(Object.keys(state.messagesById)).toHaveLength(0)
    expect(state.pinnedMessages).toHaveLength(0)
  })

  it('applyChatClear preserves firstTimers and seenUserIds', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'a'))
    s.addMessage(makeRawEvent('u2', 'b'))
    s.applyChatClear()
    const state = useChatStore.getState()
    expect(state.firstTimers).toHaveLength(2)
    expect(state.seenUserIds.size).toBe(2)
  })

  it('addPin prepends newest-first and is idempotent on messageId', () => {
    const s = useChatStore.getState()
    const pinA: PinnedMessage = {
      id: 'p_mA',
      messageId: 'mA',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'A',
      pinnedAt: new Date(1000),
    }
    const pinB: PinnedMessage = {
      id: 'p_mB',
      messageId: 'mB',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'B',
      pinnedAt: new Date(2000),
    }
    s.addPin(pinA)
    s.addPin(pinB)
    expect(useChatStore.getState().pinnedMessages.map((p) => p.messageId)).toEqual(['mB', 'mA'])
    s.addPin({ ...pinA, id: 'p_mA_duplicate' })
    expect(useChatStore.getState().pinnedMessages).toHaveLength(2)
  })

  it('removePin removes by messageId and no-ops when absent', () => {
    const s = useChatStore.getState()
    s.addPin({
      id: 'p_mA',
      messageId: 'mA',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'A',
      pinnedAt: new Date(),
    })
    s.removePin('nonexistent')
    expect(useChatStore.getState().pinnedMessages).toHaveLength(1)
    s.removePin('mA')
    expect(useChatStore.getState().pinnedMessages).toHaveLength(0)
  })

  it('resetForNewChannel also clears rows / messagesById / pinnedMessages', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'hello'))
    s.addPin({
      id: 'p_1',
      messageId: 'mA',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'A',
      pinnedAt: new Date(),
    })
    s.resetForNewChannel()
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(0)
    expect(Object.keys(state.messagesById)).toHaveLength(0)
    expect(state.pinnedMessages).toHaveLength(0)
  })

  it('clearMessages also clears rows + messagesById + pinnedMessages, preserves firstTimers', () => {
    const s = useChatStore.getState()
    s.addMessage(makeRawEvent('u1', 'a'))
    s.addMessage(makeRawEvent('u2', 'b'))
    s.clearMessages()
    const state = useChatStore.getState()
    expect(state.rows).toHaveLength(0)
    expect(Object.keys(state.messagesById)).toHaveLength(0)
    expect(state.firstTimers).toHaveLength(2)
  })
})
