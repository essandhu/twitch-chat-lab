import type {
  Badge,
  ChannelChatMessageEvent,
  ChannelChatNotificationEvent,
  ChatMessage,
  ChatMessageReply,
  MessageFragment,
  PinnedMessage,
  RawBadge,
  RawMessageFragment,
  RawReplyEnvelope,
  SystemEvent,
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

const normalizeReply = (raw: RawReplyEnvelope): ChatMessageReply => ({
  parentMessageId: raw.parent_message_id,
  parentUserLogin: raw.parent_user_login,
  parentUserName: raw.parent_user_name,
  parentMessageText: raw.parent_message_body,
  threadParentMessageId: raw.thread_parent_message_id || null,
})

export const buildChatMessage = (
  raw: ChannelChatMessageEvent,
  isFirstInSession: boolean,
): ChatMessage => {
  const base: ChatMessage = {
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
    messageType: raw.message_type,
  }
  if (raw.reply) base.reply = normalizeReply(raw.reply)
  if (raw.cheer) base.cheer = { bits: raw.cheer.bits }
  return base
}

// -----------------------------------------------------------------------------
// Phase 6 — SystemEvent + PinnedMessage mappers
// -----------------------------------------------------------------------------

const chatterName = (raw: ChannelChatNotificationEvent): string => {
  if (raw.chatter_is_anonymous) return 'Anonymous'
  return raw.chatter_user_name ?? 'Anonymous'
}

export const buildSystemEvent = (raw: ChannelChatNotificationEvent): SystemEvent | null => {
  switch (raw.notice_type) {
    case 'sub': {
      const p = raw.sub
      if (!p) return null
      return {
        noticeType: 'sub',
        userName: chatterName(raw),
        tier: p.sub_tier,
        cumulativeMonths: p.duration_months,
        isGift: false,
      }
    }
    case 'resub': {
      const p = raw.resub
      if (!p) return null
      return {
        noticeType: 'resub',
        userName: chatterName(raw),
        tier: p.sub_tier,
        cumulativeMonths: p.cumulative_months,
        streakMonths: p.streak_months,
        durationMonths: p.duration_months,
      }
    }
    case 'sub_gift': {
      const p = raw.sub_gift
      if (!p) return null
      return {
        noticeType: 'gift-sub',
        fromUserName: chatterName(raw),
        total: 1,
        tier: p.sub_tier,
        isAnonymous: raw.chatter_is_anonymous,
      }
    }
    case 'community_sub_gift': {
      const p = raw.community_sub_gift
      if (!p) return null
      return {
        noticeType: 'gift-sub',
        fromUserName: chatterName(raw),
        total: p.total,
        tier: p.sub_tier,
        isAnonymous: raw.chatter_is_anonymous,
      }
    }
    case 'raid': {
      const p = raw.raid
      if (!p) return null
      return { noticeType: 'raid', fromUserName: p.user_name, viewers: p.viewer_count }
    }
    case 'announcement': {
      const p = raw.announcement
      if (!p) return null
      return {
        noticeType: 'announcement',
        userName: chatterName(raw),
        body: raw.message?.text || raw.system_message || '',
        color: p.color,
      }
    }
    case 'bits_badge_tier': {
      const p = raw.bits_badge_tier
      if (!p) return null
      return { noticeType: 'bits-badge-tier', userName: chatterName(raw), tier: p.tier }
    }
    case 'charity_donation': {
      const p = raw.charity_donation
      if (!p) return null
      const divisor = Math.pow(10, p.amount.decimal_place)
      return {
        noticeType: 'charity-donation',
        userName: chatterName(raw),
        amount: { value: p.amount.value / divisor, currency: p.amount.currency },
      }
    }
    case 'shared_chat_join': {
      const p = raw.shared_chat_join
      if (!p) return null
      return { noticeType: 'shared-chat-joined', broadcasterUserName: p.broadcaster_user_name }
    }
    default:
      return null
  }
}

export const buildPinnedMessage = (raw: ChannelChatNotificationEvent): PinnedMessage | null => {
  if (raw.notice_type !== 'pin_chat_message') return null
  const p = raw.pin_chat_message
  if (!p) return null
  const pinnedAt = p.pinned_at ? new Date(p.pinned_at) : new Date()
  return {
    id: `${raw.message_id}:pin`,
    messageId: p.message.id,
    userLogin: raw.chatter_user_login ?? '',
    userName: raw.chatter_user_name ?? '',
    text: p.message.text,
    pinnedAt,
  }
}
