import { beforeEach, describe, expect, it } from 'vitest'
import type {
  ChannelChatMessageEvent,
  ChannelChatNotificationEvent,
  ChannelRaidEvent,
  ChannelSubscribeEvent,
  PinnedMessage,
} from '../types/twitch'
import { annotationFromEvent } from '../services/annotationFromEvent'
import { buildSystemEvent } from './chatMessageMapper'
import { useChatStore } from './chatStore'

// -----------------------------------------------------------------------------
// Helpers — canonical raw event builders
// -----------------------------------------------------------------------------

const rawMessage = (
  messageId: string,
  userId: string,
  text: string,
  overrides: Partial<ChannelChatMessageEvent> = {},
): ChannelChatMessageEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: userId,
  chatter_user_login: userId,
  chatter_user_name: userId,
  message_id: messageId,
  message: { text, fragments: [{ type: 'text', text }] },
  color: '#ffffff',
  badges: [],
  message_type: 'text',
  ...overrides,
})

const rawNotification = (
  noticeType: string,
  overrides: Partial<ChannelChatNotificationEvent>,
): ChannelChatNotificationEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: 'u_chatter',
  chatter_user_login: 'chatter',
  chatter_user_name: 'Chatter',
  chatter_is_anonymous: false,
  color: '#ffffff',
  badges: [],
  system_message: '',
  message_id: `notif_${noticeType}_${Math.random().toString(36).slice(2, 8)}`,
  message: { text: '', fragments: [] },
  notice_type: noticeType,
  ...overrides,
})

// -----------------------------------------------------------------------------
// Phase 6 scripted sequence — delta assertions after each step
// -----------------------------------------------------------------------------

describe('chatStore — scripted Phase 6 event sequence', () => {
  beforeEach(() => {
    useChatStore.getState().resetForNewChannel()
  })

  it('text → reply → sub → gift-sub → raid → announcement → pin → delete → user-clear → chat-clear', () => {
    const s = useChatStore.getState()

    // 1) Plain text message
    s.addMessage(rawMessage('m1', 'alice', 'hello world'))
    let state = useChatStore.getState()
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]!.kind).toBe('message')
    expect(state.messagesById['m1']).toBeDefined()

    // 2) Reply to m1
    s.addMessage(
      rawMessage('m2', 'bob', '@alice same here', {
        reply: {
          parent_message_id: 'm1',
          parent_message_body: 'hello world',
          parent_user_id: 'alice',
          parent_user_login: 'alice',
          parent_user_name: 'alice',
          thread_parent_message_id: 'm1',
        },
      }),
    )
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(2)
    expect(state.messagesById['m2']!.reply?.parentMessageId).toBe('m1')

    // 3) sub (system event row)
    const subEvent = buildSystemEvent(
      rawNotification('sub', {
        chatter_user_name: 'Alice',
        sub: { sub_tier: '1000', is_prime: false, duration_months: 1 },
      }),
    )!
    s.addSystemEvent(subEvent)
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(3)
    expect(state.rows[2]!.kind).toBe('system')

    // 4) community-gift-sub
    const giftEvent = buildSystemEvent(
      rawNotification('community_sub_gift', {
        chatter_user_name: 'Alice',
        community_sub_gift: {
          id: 'g1',
          total: 5,
          sub_tier: '1000',
          cumulative_total: 20,
        },
      }),
    )!
    s.addSystemEvent(giftEvent)
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(4)

    // 5) raid (system event row)
    const raidEvent = buildSystemEvent(
      rawNotification('raid', {
        raid: {
          user_id: 'u_charlie',
          user_login: 'charlie',
          user_name: 'Charlie',
          viewer_count: 42,
          profile_image_url: '',
        },
      }),
    )!
    s.addSystemEvent(raidEvent)
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(5)

    // 6) announcement
    const announceEvent = buildSystemEvent(
      rawNotification('announcement', {
        chatter_user_name: 'Mod',
        system_message: 'Break in 10',
        announcement: { color: 'PURPLE' },
        message: { text: 'Break in 10', fragments: [] },
      }),
    )!
    s.addSystemEvent(announceEvent)
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(6)

    // 7) pin — does NOT append a row, adds to pinnedMessages
    const pin: PinnedMessage = {
      id: 'pin_m1',
      messageId: 'm1',
      userLogin: 'mod',
      userName: 'Mod',
      text: 'hello world',
      pinnedAt: new Date(),
    }
    s.addPin(pin)
    state = useChatStore.getState()
    expect(state.pinnedMessages).toHaveLength(1)
    expect(state.pinnedMessages[0]!.messageId).toBe('m1')
    expect(state.rows).toHaveLength(6) // rows unchanged

    // 8) message-delete on m1
    s.applyDeletion('m1')
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(6) // same length — replacement, not append
    const deletionRow = state.rows.find((r) => r.kind === 'deletion')
    expect(deletionRow).toBeDefined()
    expect(state.messagesById['m1']).toBeUndefined()

    // 9) user-clear on bob — mutates bob's message row into a deletion row in place
    s.applyUserClear('bob')
    state = useChatStore.getState()
    // bob's row (m2) is now kind:'deletion'. Row count unchanged.
    expect(state.rows).toHaveLength(6)
    const deletionsAfterClear = state.rows.filter((r) => r.kind === 'deletion')
    expect(deletionsAfterClear.length).toBeGreaterThanOrEqual(2)
    expect(state.messagesById['m2']).toBeUndefined()

    // 10) chat-clear — wipes rows/messagesById/pinnedMessages,
    // inserts single chat-cleared row.
    s.applyChatClear()
    state = useChatStore.getState()
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]!.kind).toBe('chat-cleared')
    expect(Object.keys(state.messagesById)).toHaveLength(0)
    expect(state.pinnedMessages).toHaveLength(0)
  })

  it('heatmap annotation pipeline remains independent — raid + sub via annotationFromEvent still produce annotations', () => {
    const raid: ChannelRaidEvent = {
      from_broadcaster_user_id: 'u_charlie',
      from_broadcaster_user_login: 'charlie',
      from_broadcaster_user_name: 'Charlie',
      to_broadcaster_user_id: 'b1',
      to_broadcaster_user_login: 'broadcaster',
      to_broadcaster_user_name: 'Broadcaster',
      viewers: 42,
    }
    const raidAnnotation = annotationFromEvent('channel.raid', raid)
    expect(raidAnnotation).not.toBeNull()

    const sub: ChannelSubscribeEvent = {
      user_id: 'u_alice',
      user_login: 'alice',
      user_name: 'Alice',
      broadcaster_user_id: 'b1',
      broadcaster_user_login: 'broadcaster',
      broadcaster_user_name: 'Broadcaster',
      tier: '1000',
      is_gift: false,
    }
    const subAnnotation = annotationFromEvent('channel.subscribe', sub)
    expect(subAnnotation).not.toBeNull()
  })

  it('firstTimers + seenUserIds are NOT mutated by system events / deletions / user-clears / chat-clears', () => {
    const s = useChatStore.getState()
    s.addMessage(rawMessage('m1', 'alice', 'hi'))
    s.addMessage(rawMessage('m2', 'bob', 'hey'))
    const firstTimersBefore = useChatStore.getState().firstTimers.length
    const seenBefore = useChatStore.getState().seenUserIds.size

    s.addSystemEvent({
      noticeType: 'raid',
      fromUserName: 'Charlie',
      viewers: 3,
    })
    s.applyDeletion('m1')
    s.applyUserClear('bob')
    s.applyChatClear()

    const state = useChatStore.getState()
    expect(state.firstTimers.length).toBe(firstTimersBefore)
    expect(state.seenUserIds.size).toBe(seenBefore)
  })
})
