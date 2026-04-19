import type { WebSocketRoute } from '@playwright/test'

export interface ChatMessageSpec {
  username: string
  userId?: string
  text: string
  badges?: Array<{ set_id: string; id: string; info?: string }>
  fragments?: Array<
    | { type: 'text'; text: string }
    | { type: 'emote'; text: string; emote: { id: string } }
  >
  color?: string
}

export interface RaidSpec {
  fromBroadcaster: string
  viewers: number
}

export interface SubscriptionSpec {
  user: string
}

const now = () => new Date().toISOString()
const messageId = () => `msg_${Math.random().toString(36).slice(2, 12)}`

const buildFragments = (text: string) => [{ type: 'text' as const, text }]

const isoInPast = (ms: number) => new Date(Date.now() - ms).toISOString()

export interface ReplySpec {
  username: string
  userId?: string
  text: string
  parent: {
    userName: string
    userLogin: string
    text: string
    messageId: string
  }
}

export interface CheerSpec {
  username: string
  userId?: string
  text: string
  bits: number
}

export interface PushSystemOptions {
  chatter?: { userLogin: string; userName: string; userId?: string }
  systemMessage?: string
  subPayload?: Record<string, unknown>
}

export interface PinSpec {
  messageId: string
  text: string
  userName: string
  userLogin: string
  pinnedAt?: string
}

export interface FakeEventSubHandle {
  ws: WebSocketRoute
  pushChatMessage: (spec: ChatMessageSpec) => void
  pushRaid: (spec: RaidSpec) => void
  pushSubscription: (spec: SubscriptionSpec) => void
  pushHypeTrainBegin: () => void
  pushHypeTrainEnd: () => void
  // --- Phase 6 pushers ---
  pushReply: (spec: ReplySpec) => void
  pushCheer: (spec: CheerSpec) => void
  pushSystemNotification: (noticeType: string, opts?: PushSystemOptions) => void
  pushMessageDelete: (opts: { messageId: string; targetUserLogin?: string }) => void
  pushUserClear: (opts: { targetUserId: string; targetUserLogin?: string }) => void
  pushChatClear: () => void
  pushPin: (spec: PinSpec) => void
  pushUnpin: (opts: { messageId: string }) => void
}

export const openFakeEventSub = (ws: WebSocketRoute): FakeEventSubHandle => {
  // Push session_welcome synchronously after the client connects.
  ws.send(
    JSON.stringify({
      metadata: {
        message_id: messageId(),
        message_type: 'session_welcome',
        message_timestamp: now(),
      },
      payload: {
        session: {
          id: 'fake-session-id',
          status: 'connected',
          keepalive_timeout_seconds: 10,
          reconnect_url: null,
          connected_at: now(),
        },
      },
    }),
  )

  const push = (subscriptionType: string, event: unknown) => {
    ws.send(
      JSON.stringify({
        metadata: {
          message_id: messageId(),
          message_type: 'notification',
          // ~50ms in the past so EventSub-latency metric reads a small positive value
          message_timestamp: isoInPast(50),
          subscription_type: subscriptionType,
          subscription_version: subscriptionType.startsWith('channel.hype_train') ? '2' : '1',
        },
        payload: {
          subscription: {
            id: `sub_${subscriptionType}`,
            type: subscriptionType,
            version: subscriptionType.startsWith('channel.hype_train') ? '2' : '1',
            status: 'enabled',
            cost: 0,
            condition: {},
            transport: { method: 'websocket', session_id: 'fake-session-id' },
            created_at: now(),
          },
          event,
        },
      }),
    )
  }

  return {
    ws,
    pushChatMessage: (spec: ChatMessageSpec) => {
      const userId = spec.userId ?? `uid_${spec.username}`
      const fragments = spec.fragments ?? buildFragments(spec.text)
      push('channel.chat.message', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        chatter_user_id: userId,
        chatter_user_login: spec.username.toLowerCase(),
        chatter_user_name: spec.username,
        message_id: messageId(),
        message: {
          text: spec.text,
          fragments,
        },
        color: spec.color ?? '#9146FF',
        badges: spec.badges ?? [],
        message_type: 'text',
        source_broadcaster_user_id: null,
      })
    },
    pushRaid: (spec: RaidSpec) => {
      push('channel.raid', {
        from_broadcaster_user_id: `uid_${spec.fromBroadcaster}`,
        from_broadcaster_user_login: spec.fromBroadcaster.toLowerCase(),
        from_broadcaster_user_name: spec.fromBroadcaster,
        to_broadcaster_user_id: '99999999',
        to_broadcaster_user_login: 'demouser',
        to_broadcaster_user_name: 'Demouser',
        viewers: spec.viewers,
      })
    },
    pushSubscription: (spec: SubscriptionSpec) => {
      push('channel.subscribe', {
        user_id: `uid_${spec.user}`,
        user_login: spec.user.toLowerCase(),
        user_name: spec.user,
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        tier: '1000',
        is_gift: false,
      })
    },
    pushHypeTrainBegin: () => {
      push('channel.hype_train.begin', {
        id: 'hype_1',
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        total: 100,
        progress: 10,
        goal: 500,
        started_at: now(),
      })
    },
    pushHypeTrainEnd: () => {
      push('channel.hype_train.end', {
        id: 'hype_1',
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        level: 2,
        total: 1200,
        ended_at: now(),
      })
    },

    // -------------------------------------------------------------------------
    // Phase 6 pushers
    // -------------------------------------------------------------------------

    pushReply: (spec: ReplySpec) => {
      const userId = spec.userId ?? `uid_${spec.username}`
      push('channel.chat.message', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        chatter_user_id: userId,
        chatter_user_login: spec.username.toLowerCase(),
        chatter_user_name: spec.username,
        message_id: messageId(),
        message: { text: spec.text, fragments: buildFragments(spec.text) },
        color: '#9146FF',
        badges: [],
        message_type: 'text',
        reply: {
          parent_message_id: spec.parent.messageId,
          parent_message_body: spec.parent.text,
          parent_user_id: `uid_${spec.parent.userLogin}`,
          parent_user_login: spec.parent.userLogin,
          parent_user_name: spec.parent.userName,
          thread_parent_message_id: spec.parent.messageId,
        },
        source_broadcaster_user_id: null,
      })
    },

    pushCheer: (spec: CheerSpec) => {
      const userId = spec.userId ?? `uid_${spec.username}`
      push('channel.chat.message', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        chatter_user_id: userId,
        chatter_user_login: spec.username.toLowerCase(),
        chatter_user_name: spec.username,
        message_id: messageId(),
        message: { text: spec.text, fragments: buildFragments(spec.text) },
        color: '#9146FF',
        badges: [],
        message_type: 'text',
        cheer: { bits: spec.bits },
        source_broadcaster_user_id: null,
      })
    },

    pushSystemNotification: (noticeType: string, opts: PushSystemOptions = {}) => {
      const chatter = opts.chatter ?? {
        userLogin: 'alice',
        userName: 'Alice',
        userId: 'uid_alice',
      }
      push('channel.chat.notification', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        chatter_user_id: chatter.userId ?? `uid_${chatter.userLogin}`,
        chatter_user_login: chatter.userLogin,
        chatter_user_name: chatter.userName,
        chatter_is_anonymous: false,
        color: '#9146FF',
        badges: [],
        system_message: opts.systemMessage ?? '',
        message_id: messageId(),
        message: { text: opts.systemMessage ?? '', fragments: [] },
        notice_type: noticeType,
        ...(opts.subPayload ?? {}),
      })
    },

    pushMessageDelete: ({
      messageId: targetMessageId,
      targetUserLogin = 'victim',
    }) => {
      push('channel.chat.message_delete', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        target_user_id: `uid_${targetUserLogin}`,
        target_user_login: targetUserLogin,
        target_user_name: targetUserLogin,
        message_id: targetMessageId,
      })
    },

    pushUserClear: ({ targetUserId, targetUserLogin = 'spammer' }) => {
      push('channel.chat.clear_user_messages', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        target_user_id: targetUserId,
        target_user_login: targetUserLogin,
        target_user_name: targetUserLogin,
      })
    },

    pushChatClear: () => {
      push('channel.chat.clear', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
      })
    },

    pushPin: (spec: PinSpec) => {
      push('channel.chat.notification', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        chatter_user_id: `uid_${spec.userLogin}`,
        chatter_user_login: spec.userLogin,
        chatter_user_name: spec.userName,
        chatter_is_anonymous: false,
        color: '#9146FF',
        badges: [],
        system_message: '',
        message_id: messageId(),
        message: { text: '', fragments: [] },
        notice_type: 'pin_chat_message',
        pin_chat_message: {
          message: { id: spec.messageId, text: spec.text },
          pinned_at: spec.pinnedAt ?? now(),
        },
      })
    },

    pushUnpin: ({ messageId: targetMessageId }) => {
      push('channel.chat.notification', {
        broadcaster_user_id: '99999999',
        broadcaster_user_login: 'demouser',
        broadcaster_user_name: 'Demouser',
        chatter_user_id: 'uid_mod',
        chatter_user_login: 'mod',
        chatter_user_name: 'Mod',
        chatter_is_anonymous: false,
        color: '#9146FF',
        badges: [],
        system_message: '',
        message_id: messageId(),
        message: { text: '', fragments: [] },
        notice_type: 'unpin_chat_message',
        unpin_chat_message: { message: { id: targetMessageId } },
      })
    },
  }
}
