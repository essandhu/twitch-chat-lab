import { describe, expect, it } from 'vitest'
import type {
  ChannelChatMessageEvent,
  ChannelChatNotificationEvent,
  RawMessageFragment,
} from '../types/twitch'
import {
  buildChatMessage,
  buildPinnedMessage,
  buildSystemEvent,
  normalizeBadges,
  normalizeFragment,
} from './chatMessageMapper'

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
  message_id: `m_${userId}`,
  message: {
    text,
    fragments: [{ type: 'text', text }],
  },
  color: '#ffffff',
  badges: [],
  message_type: 'text',
  ...overrides,
})

const makeRawNotification = (
  noticeType: string,
  overrides: Partial<ChannelChatNotificationEvent> = {},
): ChannelChatNotificationEvent => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'broadcaster',
  broadcaster_user_name: 'Broadcaster',
  chatter_user_id: 'u1',
  chatter_user_login: 'alice',
  chatter_user_name: 'Alice',
  chatter_is_anonymous: false,
  color: '#ffffff',
  badges: [],
  system_message: '',
  message_id: `notif_${noticeType}_${Math.random().toString(36).slice(2, 8)}`,
  message: { text: '', fragments: [] },
  notice_type: noticeType,
  ...overrides,
})

describe('chatMessageMapper', () => {
  it('normalizeBadges converts snake_case wire badges to camelCase Badge[]', () => {
    const badges = normalizeBadges([
      { set_id: 'subscriber', id: '12', info: '12' },
      { set_id: 'moderator', id: '1', info: '' },
    ])
    expect(badges).toEqual([
      { setId: 'subscriber', id: '12', info: '12' },
      { setId: 'moderator', id: '1', info: '' },
    ])
  })

  it('normalizeFragment maps text, emote, mention, and cheermote variants', () => {
    const textFrag: RawMessageFragment = { type: 'text', text: 'hello' }
    const emoteFrag: RawMessageFragment = {
      type: 'emote',
      text: 'PogChamp',
      emote: { id: '305954156' },
    }
    const mentionFrag: RawMessageFragment = {
      type: 'mention',
      text: '@erick',
      mention: { user_id: 'u1', user_login: 'erick', user_name: 'Erick' },
    }
    const cheerFrag: RawMessageFragment = {
      type: 'cheermote',
      text: 'cheer100',
      cheermote: { prefix: 'cheer', bits: 100, tier: 1 },
    }

    expect(normalizeFragment(textFrag)).toEqual({ type: 'text', text: 'hello' })
    expect(normalizeFragment(emoteFrag)).toEqual({
      type: 'emote',
      text: 'PogChamp',
      emote: { id: '305954156' },
    })
    expect(normalizeFragment(mentionFrag)).toEqual({
      type: 'mention',
      text: '@erick',
      mention: { userId: 'u1', userLogin: 'erick' },
    })
    expect(normalizeFragment(cheerFrag)).toEqual({
      type: 'cheermote',
      text: 'cheer100',
      cheermote: { prefix: 'cheer', bits: 100, tier: 1 },
    })
  })

  it('buildChatMessage assembles ChatMessage with isFirstInSession flag and channel-points highlight flag', () => {
    const raw = makeRawEvent('u1', 'Hello PogChamp', {
      message: {
        text: 'Hello PogChamp',
        fragments: [
          { type: 'text', text: 'Hello ' },
          { type: 'emote', text: 'PogChamp', emote: { id: '305954156' } },
        ],
      },
      badges: [{ set_id: 'subscriber', id: '12', info: '12' }],
      message_type: 'channel_points_highlighted',
    })

    const msg = buildChatMessage(raw, true)
    expect(msg.id).toBe('m_u1')
    expect(msg.userId).toBe('u1')
    expect(msg.userLogin).toBe('user_u1')
    expect(msg.displayName).toBe('Useru1')
    expect(msg.color).toBe('#ffffff')
    expect(msg.text).toBe('Hello PogChamp')
    expect(msg.isFirstInSession).toBe(true)
    expect(msg.isHighlighted).toBe(true)
    expect(msg.badges).toEqual([{ setId: 'subscriber', id: '12', info: '12' }])
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'emote', text: 'PogChamp', emote: { id: '305954156' } },
    ])
    expect(msg.timestamp).toBeInstanceOf(Date)

    // Non-first, non-highlighted path flips the two flags.
    const plain = buildChatMessage(makeRawEvent('u2', 'hi'), false)
    expect(plain.isFirstInSession).toBe(false)
    expect(plain.isHighlighted).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Phase 6 — new passthrough fields on buildChatMessage
  // ---------------------------------------------------------------------------

  it('buildChatMessage passes through messageType verbatim from raw.message_type', () => {
    const plain = buildChatMessage(makeRawEvent('u1', 'hi'), false)
    expect(plain.messageType).toBe('text')

    const intro = buildChatMessage(
      makeRawEvent('u2', 'hi', { message_type: 'user_intro' }),
      false,
    )
    expect(intro.messageType).toBe('user_intro')

    const subOnly = buildChatMessage(
      makeRawEvent('u3', 'hi', { message_type: 'channel_points_sub_only' }),
      false,
    )
    expect(subOnly.messageType).toBe('channel_points_sub_only')
  })

  it('buildChatMessage populates reply camelCase when raw.reply is set, undefined otherwise', () => {
    const withReply = buildChatMessage(
      makeRawEvent('u1', '@alice hi', {
        reply: {
          parent_message_id: 'pm1',
          parent_message_body: 'what time is stream?',
          parent_user_id: 'pu1',
          parent_user_login: 'alice',
          parent_user_name: 'Alice',
          thread_parent_message_id: 'pm1',
        },
      }),
      false,
    )
    expect(withReply.reply).toEqual({
      parentMessageId: 'pm1',
      parentUserLogin: 'alice',
      parentUserName: 'Alice',
      parentMessageText: 'what time is stream?',
      threadParentMessageId: 'pm1',
    })

    const noReply = buildChatMessage(makeRawEvent('u2', 'hi'), false)
    expect(noReply.reply).toBeUndefined()
  })

  it('buildChatMessage passes through cheer when present, undefined otherwise', () => {
    const withCheer = buildChatMessage(
      makeRawEvent('u1', 'cheer100', { cheer: { bits: 100 } }),
      false,
    )
    expect(withCheer.cheer).toEqual({ bits: 100 })

    const noCheer = buildChatMessage(makeRawEvent('u2', 'plain'), false)
    expect(noCheer.cheer).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // buildSystemEvent — per-notice-type mapping
  // ---------------------------------------------------------------------------

  it('buildSystemEvent maps "sub" to { noticeType: "sub", ... }', () => {
    const raw = makeRawNotification('sub', {
      chatter_user_name: 'Alice',
      sub: { sub_tier: '1000', is_prime: false, duration_months: 1 },
    })
    const ev = buildSystemEvent(raw)
    expect(ev).toEqual({
      noticeType: 'sub',
      userName: 'Alice',
      tier: '1000',
      cumulativeMonths: 1,
      isGift: false,
    })
  })

  it('buildSystemEvent maps "resub" to { noticeType: "resub", ... } with optional streakMonths', () => {
    const raw = makeRawNotification('resub', {
      chatter_user_name: 'Alice',
      resub: {
        sub_tier: '2000',
        is_prime: false,
        is_gift: false,
        cumulative_months: 6,
        duration_months: 1,
        streak_months: 3,
      },
    })
    const ev = buildSystemEvent(raw)
    expect(ev).toEqual({
      noticeType: 'resub',
      userName: 'Alice',
      tier: '2000',
      cumulativeMonths: 6,
      streakMonths: 3,
      durationMonths: 1,
    })
  })

  it('buildSystemEvent maps "sub_gift" (single) to { noticeType: "gift-sub", total: 1, ... }', () => {
    const raw = makeRawNotification('sub_gift', {
      chatter_user_name: 'Alice',
      sub_gift: {
        duration_months: 1,
        cumulative_total: 5,
        recipient_user_id: 'u2',
        recipient_user_login: 'bob',
        recipient_user_name: 'Bob',
        sub_tier: '1000',
        community_gift_id: null,
      },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'gift-sub',
      fromUserName: 'Alice',
      total: 1,
      tier: '1000',
      isAnonymous: false,
    })
  })

  it('buildSystemEvent maps "community_sub_gift" to { noticeType: "gift-sub", total, tier, ... }', () => {
    const raw = makeRawNotification('community_sub_gift', {
      chatter_user_name: 'Alice',
      community_sub_gift: {
        id: 'g1',
        total: 5,
        sub_tier: '1000',
        cumulative_total: 20,
      },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'gift-sub',
      fromUserName: 'Alice',
      total: 5,
      tier: '1000',
      isAnonymous: false,
    })
  })

  it('buildSystemEvent maps anonymous community gift (chatter_is_anonymous=true) to isAnonymous: true', () => {
    const raw = makeRawNotification('community_sub_gift', {
      chatter_is_anonymous: true,
      chatter_user_name: null,
      community_sub_gift: { id: 'g2', total: 1, sub_tier: '1000', cumulative_total: null },
    })
    const ev = buildSystemEvent(raw)
    expect(ev?.noticeType).toBe('gift-sub')
    if (ev?.noticeType === 'gift-sub') {
      expect(ev.isAnonymous).toBe(true)
      expect(ev.fromUserName).toBe('Anonymous')
    }
  })

  it('buildSystemEvent maps "raid" to { noticeType: "raid", fromUserName, viewers }', () => {
    const raw = makeRawNotification('raid', {
      raid: {
        user_id: 'u10',
        user_login: 'charlie',
        user_name: 'Charlie',
        viewer_count: 42,
        profile_image_url: 'x',
      },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'raid',
      fromUserName: 'Charlie',
      viewers: 42,
    })
  })

  it('buildSystemEvent maps "announcement" to { noticeType: "announcement", userName, body, color }', () => {
    const raw = makeRawNotification('announcement', {
      chatter_user_name: 'Mod',
      system_message: 'Stream ends in 15 min',
      announcement: { color: 'PURPLE' },
      message: { text: 'Stream ends in 15 min', fragments: [] },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'announcement',
      userName: 'Mod',
      body: 'Stream ends in 15 min',
      color: 'PURPLE',
    })
  })

  it('buildSystemEvent maps "bits_badge_tier" to { noticeType: "bits-badge-tier", userName, tier }', () => {
    const raw = makeRawNotification('bits_badge_tier', {
      chatter_user_name: 'Alice',
      bits_badge_tier: { tier: 1000 },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'bits-badge-tier',
      userName: 'Alice',
      tier: 1000,
    })
  })

  it('buildSystemEvent maps "charity_donation" to { noticeType: "charity-donation", userName, amount }', () => {
    const raw = makeRawNotification('charity_donation', {
      chatter_user_name: 'Alice',
      charity_donation: {
        charity_name: 'Goodwill',
        amount: { value: 500, decimal_place: 2, currency: 'USD' },
      },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'charity-donation',
      userName: 'Alice',
      amount: { value: 5, currency: 'USD' },
    })
  })

  it('buildSystemEvent maps "shared_chat_join" to { noticeType: "shared-chat-joined", broadcasterUserName }', () => {
    const raw = makeRawNotification('shared_chat_join', {
      shared_chat_join: {
        broadcaster_user_id: 'b2',
        broadcaster_user_login: 'friend',
        broadcaster_user_name: 'Friend',
      },
    })
    expect(buildSystemEvent(raw)).toEqual({
      noticeType: 'shared-chat-joined',
      broadcasterUserName: 'Friend',
    })
  })

  it('buildSystemEvent returns null for pin_chat_message, unpin_chat_message, and unknown notice types', () => {
    expect(
      buildSystemEvent(
        makeRawNotification('pin_chat_message', {
          pin_chat_message: { message: { id: 'm1', text: 'pinned' } },
        }),
      ),
    ).toBeNull()
    expect(
      buildSystemEvent(
        makeRawNotification('unpin_chat_message', {
          unpin_chat_message: { message: { id: 'm1' } },
        }),
      ),
    ).toBeNull()
    expect(buildSystemEvent(makeRawNotification('brand_new_event_2030'))).toBeNull()
    expect(buildSystemEvent(makeRawNotification('shared_chat_sub'))).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // buildPinnedMessage
  // ---------------------------------------------------------------------------

  it('buildPinnedMessage maps "pin_chat_message" to a PinnedMessage', () => {
    const raw = makeRawNotification('pin_chat_message', {
      chatter_user_login: 'mod',
      chatter_user_name: 'Mod',
      pin_chat_message: {
        message: { id: 'm42', text: 'Read the FAQ' },
        pinned_at: '2026-04-18T12:00:00.000Z',
      },
    })
    const pin = buildPinnedMessage(raw)
    expect(pin).not.toBeNull()
    expect(pin?.messageId).toBe('m42')
    expect(pin?.text).toBe('Read the FAQ')
    expect(pin?.userLogin).toBe('mod')
    expect(pin?.userName).toBe('Mod')
    expect(pin?.pinnedAt.toISOString()).toBe('2026-04-18T12:00:00.000Z')
    expect(typeof pin?.id).toBe('string')
    expect(pin?.id.length).toBeGreaterThan(0)
  })

  it('buildPinnedMessage returns null for "unpin_chat_message" and other notice types', () => {
    expect(
      buildPinnedMessage(
        makeRawNotification('unpin_chat_message', {
          unpin_chat_message: { message: { id: 'm1' } },
        }),
      ),
    ).toBeNull()
    expect(buildPinnedMessage(makeRawNotification('sub'))).toBeNull()
    expect(buildPinnedMessage(makeRawNotification('unknown'))).toBeNull()
  })

  it('buildPinnedMessage falls back to current time when pinned_at is absent', () => {
    const before = Date.now()
    const pin = buildPinnedMessage(
      makeRawNotification('pin_chat_message', {
        chatter_user_login: 'mod',
        chatter_user_name: 'Mod',
        pin_chat_message: { message: { id: 'm42', text: 'Read the FAQ' } },
      }),
    )
    const after = Date.now()
    expect(pin).not.toBeNull()
    expect(pin!.pinnedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(pin!.pinnedAt.getTime()).toBeLessThanOrEqual(after)
  })
})
