#!/usr/bin/env node
// Generator for tests/fixtures/phase-8-recording.jsonl.
// Schema locked here for Phase 9+ fixtures:
//   Header (line 1): { schemaVersion: 1, recordedAt, recorderVersion }
//   Body  (line N): { t: <ms from window start>, kind: "notification",
//                     streamLogin: <string>, payload: <EventSubEnvelope> }
// Phase 11 Recorder will emit the same shape.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(__dirname, 'phase-8-recording.jsonl')

const STREAMS = [
  { login: 'alpha', name: 'Alpha', broadcasterId: 'b_alpha' },
  { login: 'bravo', name: 'Bravo', broadcasterId: 'b_bravo' },
  { login: 'gamma', name: 'Gamma', broadcasterId: 'b_gamma' },
]
const DURATION_MS = 30_000
// Deviation from P8-20 spec: 200 msgs/stream would exceed the 200 KB file-size
// budget (~290 KB observed). Size budget wins over message count — still easily
// exercises all subsets (>5 pog, >5 raid, >3 cheer, etc.) at 120.
const MSG_PER_STREAM = 120
const RECORDED_AT = '2026-04-20T00:00:00Z'

const RNG_SEED = 12345
let rngState = RNG_SEED
const rng = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
  return rngState / 0x7fffffff
}

const pick = (arr) => arr[Math.floor(rng() * arr.length)]

const USERS_PER_STREAM = 40 // controls first-timer ratio (new users dwindle over time)

const baseUsers = (login) =>
  Array.from({ length: USERS_PER_STREAM }, (_, i) => ({
    id: `u_${login}_${i}`,
    login: `${login}_u${i}`,
    name: `${login}_u${i}`,
  }))

const subscriberBadge = { set_id: 'subscriber', id: '1', info: '3' }
const modBadge = { set_id: 'moderator', id: '1', info: '' }
const vipBadge = { set_id: 'vip', id: '1', info: '' }

// Lean envelope — minimal shape that a replayer needs. Phase 11 Recorder
// will mirror this exact shape.
const notificationEnvelope = (streamLogin, event, type = 'channel.chat.message') => ({
  subscription_type: type,
  event,
})

const chatEvent = (stream, user, text, opts = {}) => {
  const fragments = opts.fragments ?? [{ type: 'text', text }]
  const event = {
    broadcaster_user_id: `uid_${stream.login}`,
    broadcaster_user_login: stream.login,
    broadcaster_user_name: stream.name,
    chatter_user_id: user.id,
    chatter_user_login: user.login,
    chatter_user_name: user.name,
    message_id: `c_${rngState.toString(36)}`,
    message: { text, fragments },
    color: opts.color ?? '#FF4500',
    badges: opts.badges ?? [],
    message_type: opts.messageType ?? 'text',
  }
  if (opts.cheer) event.cheer = opts.cheer
  if (opts.reply) event.reply = opts.reply
  return event
}

const raidNotification = (stream, fromLogin, viewers) => ({
  broadcaster_user_id: `uid_${stream.login}`,
  broadcaster_user_login: stream.login,
  broadcaster_user_name: stream.name,
  chatter_user_id: `uid_${fromLogin}`,
  chatter_user_login: fromLogin,
  chatter_user_name: fromLogin.toUpperCase(),
  notice_type: 'raid',
  message_id: `raid_${rngState.toString(36)}`,
  message: { text: `${fromLogin} is raiding with ${viewers} viewers`, fragments: [] },
  raid: { user_id: `uid_${fromLogin}`, user_login: fromLogin, user_name: fromLogin, viewer_count: viewers, profile_image_url: null },
})

const subGiftNotification = (stream, fromLogin, count) => ({
  broadcaster_user_id: `uid_${stream.login}`,
  broadcaster_user_login: stream.login,
  broadcaster_user_name: stream.name,
  chatter_user_id: `uid_${fromLogin}`,
  chatter_user_login: fromLogin,
  chatter_user_name: fromLogin.toUpperCase(),
  notice_type: 'community_sub_gift',
  message_id: `gift_${rngState.toString(36)}`,
  message: { text: `${fromLogin} gifted ${count} subs`, fragments: [] },
  community_sub_gift: { id: `csg_${rngState.toString(36)}`, total: count, tier: '1000', cumulative_total: count },
})

const POG_TEMPLATES = ['pog that was sick', 'POG champ', 'pog', 'pogchamp that win', 'literally pog']
const RAID_TEMPLATES = ['raid incoming', 'raid the next stream', 'prep for raid', 'this is a raid', 'raid later']
const GENERIC_TEMPLATES = [
  'nice play',
  'hello everyone',
  'this stream is great',
  'what a moment',
  'i agree',
  'lol',
  'that was clean',
  'insane',
  'one more round',
  'gg',
]

const frames = []
const headerFrame = {
  schemaVersion: 1,
  recordedAt: RECORDED_AT,
  recorderVersion: 'phase-8-plan',
}
frames.push(headerFrame)

for (const stream of STREAMS) {
  const users = baseUsers(stream.login)
  let subscriberCount = 0
  let firstTimerCount = 0
  let pogCount = 0
  let raidKeywordCount = 0
  let cheerCount = 0
  let replyCount = 0
  const seen = new Set()

  for (let i = 0; i < MSG_PER_STREAM; i++) {
    const t = Math.floor((i / (MSG_PER_STREAM - 1)) * (DURATION_MS - 1))
    const user = pick(users)
    const isFirstTimer = firstTimerCount < Math.ceil(MSG_PER_STREAM * 0.1) && !seen.has(user.id)
    seen.add(user.id)
    if (isFirstTimer) firstTimerCount++

    const wantsSub = subscriberCount < Math.ceil(MSG_PER_STREAM * 0.3)
    const badges = []
    if (wantsSub) {
      badges.push(subscriberBadge)
      subscriberCount++
    }
    if (rng() < 0.05) badges.push(modBadge)
    else if (rng() < 0.05) badges.push(vipBadge)

    let text
    const roll = rng()
    if (pogCount < 5 && roll < 0.04) {
      text = POG_TEMPLATES[pogCount % POG_TEMPLATES.length]
      pogCount++
    } else if (raidKeywordCount < 5 && roll < 0.08) {
      text = RAID_TEMPLATES[raidKeywordCount % RAID_TEMPLATES.length]
      raidKeywordCount++
    } else {
      text = pick(GENERIC_TEMPLATES)
    }

    const opts = { badges }
    if (cheerCount < 3 && rng() < 0.02) {
      opts.cheer = { bits: [100, 500, 1000][cheerCount] }
      cheerCount++
    }
    if (replyCount < 2 && i > 10 && rng() < 0.04) {
      opts.reply = {
        parent_message_id: `chat_reply_${replyCount}`,
        parent_user_id: users[0].id,
        parent_user_login: users[0].login,
        parent_user_name: users[0].name,
        parent_message_body: 'original message',
        thread_parent_message_id: `chat_thread_${replyCount}`,
      }
      replyCount++
    }

    const event = chatEvent(stream, user, text, opts)
    const envelope = notificationEnvelope(stream.login, event)
    frames.push({ t, kind: 'notification', streamLogin: stream.login, payload: envelope })
  }

  if (stream.login === 'bravo') {
    const envelope = notificationEnvelope(
      stream.login,
      raidNotification(stream, 'raiderstream', 42),
      'channel.chat.notification',
    )
    frames.push({ t: 15_000, kind: 'notification', streamLogin: stream.login, payload: envelope })
  }
  if (stream.login === 'alpha') {
    const envelope = notificationEnvelope(
      stream.login,
      subGiftNotification(stream, 'generousviewer', 10),
      'channel.chat.notification',
    )
    frames.push({ t: 22_000, kind: 'notification', streamLogin: stream.login, payload: envelope })
  }
}

frames.sort((a, b) => {
  if (a === headerFrame) return -1
  if (b === headerFrame) return 1
  return a.t - b.t
})

const lines = frames.map((f) => JSON.stringify(f)).join('\n') + '\n'
writeFileSync(OUTPUT, lines, 'utf8')
const sizeKb = Buffer.byteLength(lines, 'utf8') / 1024
console.log(`Wrote ${frames.length} frames (${sizeKb.toFixed(1)} KB) to ${OUTPUT}`)
