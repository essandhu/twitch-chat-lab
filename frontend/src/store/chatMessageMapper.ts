import type {
  Badge,
  ChannelChatMessageEvent,
  ChatMessage,
  MessageFragment,
  RawBadge,
  RawMessageFragment,
} from '../types/twitch'

export const normalizeBadges = (raw: RawBadge[]): Badge[] =>
  raw.map((b) => ({ setId: b.set_id, id: b.id, info: b.info }))

export const normalizeFragment = (raw: RawMessageFragment): MessageFragment => {
  if (raw.type === 'emote') {
    return { type: 'emote', text: raw.text, emote: { id: raw.emote.id } }
  }
  if (raw.type === 'mention') {
    return {
      type: 'mention',
      text: raw.text,
      mention: { userId: raw.mention.user_id, userLogin: raw.mention.user_login },
    }
  }
  if (raw.type === 'cheermote') {
    return {
      type: 'cheermote',
      text: raw.text,
      cheermote: {
        prefix: raw.cheermote.prefix,
        bits: raw.cheermote.bits,
        tier: raw.cheermote.tier,
      },
    }
  }
  return { type: 'text', text: raw.text }
}

export const buildChatMessage = (
  raw: ChannelChatMessageEvent,
  isFirstInSession: boolean,
): ChatMessage => ({
  id: raw.message_id,
  userId: raw.chatter_user_id,
  userLogin: raw.chatter_user_login,
  displayName: raw.chatter_user_name,
  color: raw.color,
  badges: normalizeBadges(raw.badges),
  fragments: raw.message.fragments.map(normalizeFragment),
  text: raw.message.text,
  isFirstInSession,
  isHighlighted: raw.message_type === 'channel_points_highlighted',
  timestamp: new Date(),
})
