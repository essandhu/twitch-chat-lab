#!/usr/bin/env node
// Generator for tests/fixtures/phase-6-recording.jsonl.
// Phase 6 chat-fidelity surfaces: plain chat, reply, cheer, sub, resub,
// gift-sub, raid, announcement, pin + unpin, message-delete, user-clear,
// chat-clear. Single-stream 45 s session.
//
// Conforms to Phase 11 canonical schema — t: ISO-8601 string,
// payload: full EventSubFrame (metadata + payload).

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(__dirname, 'phase-6-recording.jsonl')

const STREAM = { login: 'shroud', name: 'Shroud', broadcasterId: 'b_shroud' }
const VIEWER_ID = 'v_viewer'
const RECORDED_AT = '2026-04-21T12:00:00.000Z'
const BASE_T = Date.parse('2026-04-21T12:00:00.000Z')

const seedBytes = createHash('sha256').update('phase-6-seed').digest()
let rngIdx = 0
const rng = () => {
  const b0 = seedBytes[rngIdx % seedBytes.length]
  const b1 = seedBytes[(rngIdx + 1) % seedBytes.length]
  const b2 = seedBytes[(rngIdx + 2) % seedBytes.length]
  const b3 = seedBytes[(rngIdx + 3) % seedBytes.length]
  rngIdx++
  const n = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0
  return n / 0xffffffff
}

const header = {
  schemaVersion: 1,
  recordedAt: RECORDED_AT,
  recorderVersion: 'phase-6-synthetic',
}

const iso = (offsetMs) => new Date(BASE_T + offsetMs).toISOString()

const messageIdCounter = (prefix) => {
  let n = 0
  return () => {
    n += 1
    return `${prefix}_${n.toString(36)}`
  }
}
const nextChat = messageIdCounter('c')
const nextFrameId = messageIdCounter('f')

const subscription = (type, version = '1') => ({
  id: `sub_${type}_${Math.floor(rng() * 1e6).toString(36)}`,
  status: 'enabled',
  type,
  version,
  cost: 0,
  condition: {
    broadcaster_user_id: STREAM.broadcasterId,
    user_id: VIEWER_ID,
  },
  transport: { method: 'websocket', session_id: 'session-phase6' },
  created_at: RECORDED_AT,
})

const chatMessageEvent = (chatterId, text, opts = {}) => ({
  broadcaster_user_id: STREAM.broadcasterId,
  broadcaster_user_login: STREAM.login,
  broadcaster_user_name: STREAM.name,
  chatter_user_id: chatterId,
  chatter_user_login: `${chatterId}_u`,
  chatter_user_name: `${chatterId}_U`,
  message_id: opts.messageId ?? nextChat(),
  message: {
    text,
    fragments: opts.fragments ?? [{ type: 'text', text }],
  },
  color: opts.color ?? '#66aaff',
  badges: opts.badges ?? [],
  message_type: opts.messageType ?? 'text',
  reply: opts.reply ?? null,
  cheer: opts.cheer ?? null,
})

const notificationFrame = (offsetMs, subscriptionType, event) => ({
  t: iso(offsetMs),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(offsetMs),
      subscription_type: subscriptionType,
      subscription_version: '1',
    },
    payload: {
      subscription: subscription(subscriptionType),
      event,
    },
  },
})

const frames = []

// Plain chat (t = 0–10 s)
for (let i = 0; i < 5; i += 1) {
  const texts = ['love this stream', 'gg', 'so good', 'insane play', 'LUL']
  frames.push(notificationFrame(i * 2000, 'channel.chat.message', chatMessageEvent(`u_plain_${i}`, texts[i])))
}

// Reply at t = 12 s (references message_id from earlier)
const originalMsg = { message_id: 'c_replytarget', text: 'that last play was wild' }
frames.push(
  notificationFrame(11_000, 'channel.chat.message', chatMessageEvent('u_orig', originalMsg.text, {
    messageId: originalMsg.message_id,
  })),
)
frames.push(
  notificationFrame(12_000, 'channel.chat.message', chatMessageEvent('u_reply', 'agreed!', {
    reply: {
      parent_message_id: originalMsg.message_id,
      parent_user_id: 'u_orig',
      parent_user_login: 'u_orig_u',
      parent_user_name: 'u_orig_U',
      parent_message_body: originalMsg.text,
      thread_message_id: originalMsg.message_id,
      thread_user_id: 'u_orig',
      thread_user_login: 'u_orig_u',
      thread_user_name: 'u_orig_U',
    },
  })),
)

// Cheer at t = 14 s
frames.push(
  notificationFrame(14_000, 'channel.chat.message', chatMessageEvent('u_cheerer', 'Cheer500 pog', {
    messageType: 'channel_points_highlighted',
    cheer: { bits: 500 },
    fragments: [
      { type: 'cheermote', text: 'Cheer500', cheermote: { prefix: 'Cheer', bits: 500, tier: 1 } },
      { type: 'text', text: ' pog' },
    ],
  })),
)

// Subscription at t = 16 s — channel.subscribe
frames.push({
  t: iso(16_000),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(16_000),
      subscription_type: 'channel.subscribe',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription('channel.subscribe'),
      event: {
        broadcaster_user_id: STREAM.broadcasterId,
        broadcaster_user_login: STREAM.login,
        broadcaster_user_name: STREAM.name,
        user_id: 'u_subscriber',
        user_login: 'subscriber_u',
        user_name: 'Subscriber_U',
        tier: '1000',
        is_gift: false,
      },
    },
  },
})

// Resub + gift-sub + raid + announcement + pin/unpin + delete + user-clear + chat-clear
// Each is a channel.chat.notification with a notice_type OR a dedicated subscription type.

const chatNotif = (offsetMs, noticeType, extraEvent) => ({
  t: iso(offsetMs),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(offsetMs),
      subscription_type: 'channel.chat.notification',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription('channel.chat.notification'),
      event: {
        broadcaster_user_id: STREAM.broadcasterId,
        broadcaster_user_login: STREAM.login,
        broadcaster_user_name: STREAM.name,
        chatter_user_id: 'u_notif',
        chatter_user_login: 'notif_u',
        chatter_user_name: 'notif_U',
        message_id: nextChat(),
        notice_type: noticeType,
        ...extraEvent,
      },
    },
  },
})

// Resub at t = 18s
frames.push(
  chatNotif(18_000, 'resub', {
    system_message: 'resubbed for 6 months',
    resub: { duration_months: 1, cumulative_months: 6, streak_months: 6, sub_tier: '1000', is_prime: false, is_gift: false },
  }),
)

// Gift sub at t = 20 s
frames.push(
  chatNotif(20_000, 'community_sub_gift', {
    system_message: 'gifted 5 subs',
    community_sub_gift: { id: 'gs_1', total: 5, sub_tier: '1000', cumulative_total: 5 },
  }),
)

// Raid at t = 22 s — channel.raid
frames.push({
  t: iso(22_000),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(22_000),
      subscription_type: 'channel.raid',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription('channel.raid'),
      event: {
        from_broadcaster_user_id: 'b_raider',
        from_broadcaster_user_login: 'raider',
        from_broadcaster_user_name: 'Raider',
        to_broadcaster_user_id: STREAM.broadcasterId,
        to_broadcaster_user_login: STREAM.login,
        to_broadcaster_user_name: STREAM.name,
        viewers: 42,
      },
    },
  },
})

// Announcement at t = 24 s
frames.push(
  chatNotif(24_000, 'announcement', {
    system_message: null,
    message: { text: 'Stream ending in 10!', fragments: [{ type: 'text', text: 'Stream ending in 10!' }] },
    announcement: { color: 'PRIMARY' },
  }),
)

// Pin at t = 26 s
frames.push(
  chatNotif(26_000, 'pin_chat_message', {
    pin_chat_message: {
      message: { id: 'c_pinned', text: 'stay tuned', fragments: [{ type: 'text', text: 'stay tuned' }] },
      user: { id: 'u_pinned', login: 'pinner', name: 'Pinner' },
    },
  }),
)

// Unpin at t = 30 s
frames.push(
  chatNotif(30_000, 'unpin_chat_message', {
    unpin_chat_message: {
      message: { id: 'c_pinned', text: 'stay tuned' },
    },
  }),
)

// Message delete at t = 32 s — channel.chat.message_delete
frames.push({
  t: iso(32_000),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(32_000),
      subscription_type: 'channel.chat.message_delete',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription('channel.chat.message_delete'),
      event: {
        broadcaster_user_id: STREAM.broadcasterId,
        broadcaster_user_login: STREAM.login,
        broadcaster_user_name: STREAM.name,
        target_user_id: 'u_reply',
        target_user_login: 'u_reply_u',
        target_user_name: 'u_reply_U',
        message_id: 'c_3', // the reply message from earlier
      },
    },
  },
})

// User clear at t = 35 s — channel.chat.clear_user_messages
frames.push({
  t: iso(35_000),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(35_000),
      subscription_type: 'channel.chat.clear_user_messages',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription('channel.chat.clear_user_messages'),
      event: {
        broadcaster_user_id: STREAM.broadcasterId,
        broadcaster_user_login: STREAM.login,
        broadcaster_user_name: STREAM.name,
        target_user_id: 'u_plain_0',
        target_user_login: 'u_plain_0_u',
        target_user_name: 'u_plain_0_U',
      },
    },
  },
})

// Chat clear at t = 40 s — channel.chat.clear
frames.push({
  t: iso(40_000),
  kind: 'notification',
  streamLogin: STREAM.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(40_000),
      subscription_type: 'channel.chat.clear',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription('channel.chat.clear'),
      event: {
        broadcaster_user_id: STREAM.broadcasterId,
        broadcaster_user_login: STREAM.login,
        broadcaster_user_name: STREAM.name,
      },
    },
  },
})

// Trailing message at t = 45 s
frames.push(
  notificationFrame(45_000, 'channel.chat.message', chatMessageEvent('u_final', 'back again', {})),
)

const lines = [JSON.stringify(header), ...frames.map((f) => JSON.stringify(f))]
writeFileSync(OUTPUT, lines.join('\n'))
console.log(`Wrote ${OUTPUT}: ${frames.length} frames, ${(lines.join('\n').length / 1024).toFixed(1)} KB`)
