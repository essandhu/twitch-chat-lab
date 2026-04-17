import { describe, expect, it } from 'vitest'
import type { ChannelChatMessageEvent, RawMessageFragment } from '../types/twitch'
import { buildChatMessage, normalizeBadges, normalizeFragment } from './chatMessageMapper'

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
})
