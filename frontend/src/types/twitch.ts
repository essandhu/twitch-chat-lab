// =============================================================================
// Helix REST — raw response shapes (snake_case, preserve Twitch wire format)
// =============================================================================

export interface HelixResponse<T> {
  data: T[]
}

export interface HelixUser {
  id: string
  login: string
  display_name: string
  profile_image_url: string
  created_at: string
}

export interface HelixStream {
  id: string
  user_id: string
  user_login: string
  user_name: string
  title: string
  game_id: string
  game_name: string
  viewer_count: number
  started_at: string
  thumbnail_url: string
}

export interface HelixChatSettings {
  broadcaster_id: string
  slow_mode: boolean
  slow_mode_wait_time: number | null
  follower_mode: boolean
  follower_mode_duration: number | null
  subscriber_mode: boolean
  emote_mode: boolean
  unique_chat_mode: boolean
}

export interface HelixBadgeImage {
  id: string
  image_url_1x: string
  image_url_2x: string
  image_url_4x: string
}

export interface HelixBadgeVersion extends HelixBadgeImage {
  title?: string
  description?: string
  click_action?: string | null
  click_url?: string | null
}

export interface HelixBadgeSet {
  set_id: string
  versions: HelixBadgeVersion[]
}

// =============================================================================
// EventSub WebSocket — raw envelope + payloads
// =============================================================================

export type EventSubMessageType =
  | 'session_welcome'
  | 'session_keepalive'
  | 'session_reconnect'
  | 'notification'
  | 'revocation'

export interface EventSubMetadata {
  message_id: string
  message_type: EventSubMessageType
  message_timestamp: string
  subscription_type?: string
  subscription_version?: string
}

export interface EventSubSessionWelcomePayload {
  session: {
    id: string
    status: 'connected'
    connected_at: string
    keepalive_timeout_seconds: number
    reconnect_url: string | null
  }
}

export interface EventSubSessionKeepalivePayload {
  // Twitch sends an empty object payload on keepalive; shape exists for typing.
  [key: string]: unknown
}

export interface EventSubSessionReconnectPayload {
  session: {
    id: string
    status: 'reconnecting'
    connected_at: string
    keepalive_timeout_seconds: number | null
    reconnect_url: string
  }
}

export interface EventSubSubscriptionInfo {
  id: string
  status: string
  type: string
  version: string
  cost: number
  condition: Record<string, string>
  transport: { method: string; session_id?: string }
  created_at: string
}

export interface EventSubNotificationPayload<TEvent = unknown> {
  subscription: EventSubSubscriptionInfo
  event: TEvent
}

export interface EventSubRevocationPayload {
  subscription: EventSubSubscriptionInfo
}

export interface EventSubFrame<TPayload = unknown> {
  metadata: EventSubMetadata
  payload: TPayload
}

// =============================================================================
// Proxy envelope — shape emitted by the Phase 4 aggregator proxy.
// Each frame wraps the upstream Twitch EventSub envelope and tags it with the
// stream_login so the frontend can fan it out to the correct multiStream slice.
// =============================================================================

export interface ProxyEnvelope<TPayload = unknown> {
  stream_login: string
  event_type: string
  payload: EventSubFrame<TPayload>
}

export interface ProxyErrorFrame {
  error: 'upstream_lost'
  stream_login: string
}

// =============================================================================
// EventSub event payloads (snake_case — matches Twitch wire format)
// =============================================================================

export interface RawBadge {
  set_id: string
  id: string
  info: string
}

export interface RawMessageFragmentText {
  type: 'text'
  text: string
}

export interface RawMessageFragmentEmote {
  type: 'emote'
  text: string
  emote: { id: string; emote_set_id?: string; owner_id?: string | null; format?: string[] }
}

export interface RawMessageFragmentMention {
  type: 'mention'
  text: string
  mention: { user_id: string; user_name: string; user_login: string }
}

export interface RawMessageFragmentCheermote {
  type: 'cheermote'
  text: string
  cheermote: { prefix: string; bits: number; tier: number }
}

export type RawMessageFragment =
  | RawMessageFragmentText
  | RawMessageFragmentEmote
  | RawMessageFragmentMention
  | RawMessageFragmentCheermote

export interface RawReplyEnvelope {
  parent_message_id: string
  parent_message_body: string
  parent_user_id: string
  parent_user_login: string
  parent_user_name: string
  thread_parent_message_id: string
}

export interface ChannelChatMessageEvent {
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  chatter_user_id: string
  chatter_user_login: string
  chatter_user_name: string
  message_id: string
  message: {
    text: string
    fragments: RawMessageFragment[]
  }
  color: string
  badges: RawBadge[]
  message_type: 'text' | 'channel_points_highlighted' | 'channel_points_sub_only' | 'user_intro' | string
  cheer?: { bits: number } | null
  reply?: RawReplyEnvelope | null
  channel_points_custom_reward_id?: string | null
  source_broadcaster_user_id?: string | null
  source_broadcaster_user_login?: string | null
  source_broadcaster_user_name?: string | null
  source_message_id?: string | null
  source_badges?: RawBadge[] | null
}

export interface ChannelSubscribeEvent {
  user_id: string
  user_login: string
  user_name: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  tier: '1000' | '2000' | '3000'
  is_gift: boolean
}

export interface ChannelSubscriptionGiftEvent {
  user_id: string | null
  user_login: string | null
  user_name: string | null
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  total: number
  tier: '1000' | '2000' | '3000'
  cumulative_total: number | null
  is_anonymous: boolean
}

export interface ChannelRaidEvent {
  from_broadcaster_user_id: string
  from_broadcaster_user_login: string
  from_broadcaster_user_name: string
  to_broadcaster_user_id: string
  to_broadcaster_user_login: string
  to_broadcaster_user_name: string
  viewers: number
}

export interface ChannelHypeTrainBeginEvent {
  id: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  total: number
  progress: number
  goal: number
  level: number
  started_at: string
  expires_at: string
}

export interface ChannelHypeTrainEndEvent {
  id: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  level: number
  total: number
  started_at: string
  ended_at: string
  cooldown_ends_at: string
}

// -----------------------------------------------------------------------------
// channel.chat.notification (v1) — raw shape
// -----------------------------------------------------------------------------

export interface RawSubPayload {
  sub_tier: '1000' | '2000' | '3000'
  is_prime: boolean
  duration_months: number
}

export interface RawResubPayload {
  cumulative_months: number
  duration_months: number
  streak_months: number | null
  sub_tier: '1000' | '2000' | '3000'
  is_prime: boolean
  is_gift: boolean
  gifter_is_anonymous?: boolean
  gifter_user_id?: string | null
  gifter_user_login?: string | null
  gifter_user_name?: string | null
}

export interface RawSubGiftPayload {
  duration_months: number
  cumulative_total: number | null
  recipient_user_id: string
  recipient_user_login: string
  recipient_user_name: string
  sub_tier: '1000' | '2000' | '3000'
  community_gift_id: string | null
}

export interface RawCommunitySubGiftPayload {
  id: string
  total: number
  sub_tier: '1000' | '2000' | '3000'
  cumulative_total: number | null
}

export interface RawRaidPayload {
  user_id: string
  user_login: string
  user_name: string
  viewer_count: number
  profile_image_url: string
}

export interface RawAnnouncementPayload {
  color: 'PRIMARY' | 'BLUE' | 'GREEN' | 'ORANGE' | 'PURPLE'
}

export interface RawBitsBadgeTierPayload {
  tier: number
}

export interface RawCharityDonationPayload {
  charity_name: string
  amount: { value: number; decimal_place: number; currency: string }
}

export interface RawSharedChatJoinPayload {
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
}

export interface RawPinChatMessagePayload {
  message: { id: string; text: string }
  pinned_at?: string
}

export interface RawUnpinChatMessagePayload {
  message: { id: string }
}

export interface ChannelChatNotificationEvent {
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  chatter_user_id: string | null
  chatter_user_login: string | null
  chatter_user_name: string | null
  chatter_is_anonymous: boolean
  color: string
  badges: RawBadge[]
  system_message: string
  message_id: string
  message: { text: string; fragments: RawMessageFragment[] }
  notice_type: string
  sub?: RawSubPayload | null
  resub?: RawResubPayload | null
  sub_gift?: RawSubGiftPayload | null
  community_sub_gift?: RawCommunitySubGiftPayload | null
  raid?: RawRaidPayload | null
  announcement?: RawAnnouncementPayload | null
  bits_badge_tier?: RawBitsBadgeTierPayload | null
  charity_donation?: RawCharityDonationPayload | null
  shared_chat_join?: RawSharedChatJoinPayload | null
  pin_chat_message?: RawPinChatMessagePayload | null
  unpin_chat_message?: RawUnpinChatMessagePayload | null
}

// -----------------------------------------------------------------------------
// channel.chat.message_delete / clear_user_messages / clear — raw shapes
// -----------------------------------------------------------------------------

export interface ChannelChatMessageDeleteEvent {
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  target_user_id: string
  target_user_name: string
  target_user_login: string
  message_id: string
}

export interface ChannelChatClearUserMessagesEvent {
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  target_user_id: string
  target_user_name: string
  target_user_login: string
}

export interface ChannelChatClearEvent {
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
}

// =============================================================================
// Domain types (camelCase — what the rest of the app consumes)
// =============================================================================

export interface Badge {
  setId: string
  id: string
  info: string
}

export type MessageFragment =
  | { type: 'text'; text: string }
  | { type: 'emote'; text: string; emote: { id: string } }
  | { type: 'mention'; text: string; mention: { userId: string; userLogin: string } }
  | { type: 'cheermote'; text: string; cheermote: { prefix: string; bits: number; tier: number } }

export interface ChatMessageReply {
  parentMessageId: string
  parentUserLogin: string
  parentUserName: string
  parentMessageText: string
  threadParentMessageId: string | null
}

export interface ChatMessage {
  id: string
  userId: string
  userLogin: string
  displayName: string
  color: string
  badges: Badge[]
  fragments: MessageFragment[]
  text: string
  isFirstInSession: boolean
  isHighlighted: boolean
  timestamp: Date
  reply?: ChatMessageReply
  cheer?: { bits: number }
  messageType: string
}

export interface StreamSession {
  broadcasterId: string
  broadcasterLogin: string
  broadcasterDisplayName: string
  streamTitle: string
  gameName: string
  gameId: string
  viewerCount: number
  startedAt: Date
  isConnected: boolean
  profileImageUrl?: string
}

export interface FilterState {
  firstTimeOnly: boolean
  subscribersOnly: boolean
  keyword: string
  hypeModeOnly: boolean
  query?: string
  queryError?: string | null
}

export interface FirstTimerEntry {
  userId: string
  displayName: string
  userLogin: string
  message: string
  timestamp: Date
}

export interface HeatmapDataPoint {
  timestamp: number
  msgPerSec: number
}

export interface EventAnnotation {
  timestamp: number
  type: 'raid' | 'subscription' | 'hype_train_begin' | 'hype_train_end' | 'gift_sub'
  label: string
}

export interface PerfMetrics {
  messagesRenderedPerSec: number
  domNodeCount: number
  jsHeapUsedMB: number | null
  eventSubLatencyMs: number
  virtualizerRenderMs: number
}

// Outer key: badge set_id. Inner key: version id. Value: image URL (2x by default).
export type BadgeMap = Record<string, Record<string, string>>

// -----------------------------------------------------------------------------
// Phase 6 — domain types for extended chat fidelity
// -----------------------------------------------------------------------------

export type SubTier = '1000' | '2000' | '3000'

export type AnnouncementColor = 'PRIMARY' | 'BLUE' | 'GREEN' | 'ORANGE' | 'PURPLE'

export type SystemEvent =
  | {
      noticeType: 'sub'
      userName: string
      tier: SubTier
      cumulativeMonths: number
      isGift: boolean
    }
  | {
      noticeType: 'resub'
      userName: string
      tier: SubTier
      cumulativeMonths: number
      streakMonths: number | null
      durationMonths: number
    }
  | {
      noticeType: 'gift-sub'
      fromUserName: string
      total: number
      tier: SubTier
      isAnonymous: boolean
    }
  | {
      noticeType: 'raid'
      fromUserName: string
      viewers: number
    }
  | {
      noticeType: 'announcement'
      userName: string
      body: string
      color: AnnouncementColor
    }
  | {
      noticeType: 'bits-badge-tier'
      userName: string
      tier: number
    }
  | {
      noticeType: 'charity-donation'
      userName: string
      amount: { value: number; currency: string }
    }
  | {
      noticeType: 'shared-chat-joined'
      broadcasterUserName: string
    }

export interface PinnedMessage {
  id: string
  messageId: string
  userLogin: string
  userName: string
  text: string
  pinnedAt: Date
}

export type ChatRow =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'system'; id: string; event: SystemEvent; timestamp: Date }
  | { kind: 'deletion'; id: string; messageId: string; deletedAt: Date }
  | { kind: 'chat-cleared'; id: string; clearedAt: Date }

// -----------------------------------------------------------------------------
// Phase 9 — chat intelligence (heuristic layer)
// -----------------------------------------------------------------------------

export interface AnomalySignals {
  similarityBurst: number
  lexicalDiversityDrop: number
  emoteVsTextRatio: number
  newChatterInflux: number
}

export type AccountAgeBucket = 'new' | 'recent' | 'established' | 'unknown'

export interface AccountAgeRecord {
  bucket: AccountAgeBucket
  source: 'helix' | 'approximate'
  createdAt?: string
}

export type ExtractedSignalKind = 'question' | 'callout' | 'bitsContext'

export interface ExtractedSignalRef {
  messageId: string
  kind: ExtractedSignalKind
  timestamp: number
}
