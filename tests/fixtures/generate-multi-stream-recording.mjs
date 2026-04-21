#!/usr/bin/env node
// Generator for tests/fixtures/multi-stream-recording.jsonl.
// 3 streams (streamer_a, streamer_b, streamer_c) over 30 s. Balanced
// notification volume for the first 15 s. channel.raid on streamer_b
// at t = 15 s. Continues to 30 s with balanced volume.
//
// Conforms to Phase 11 canonical schema (t: ISO string, payload: full
// EventSubFrame). Frames sorted globally by t.

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(__dirname, 'multi-stream-recording.jsonl')

const STREAMS = [
  { login: 'streamer_a', name: 'Streamer A', broadcasterId: 'b_streamer_a' },
  { login: 'streamer_b', name: 'Streamer B', broadcasterId: 'b_streamer_b' },
  { login: 'streamer_c', name: 'Streamer C', broadcasterId: 'b_streamer_c' },
]
const RECORDED_AT = '2026-04-21T14:00:00.000Z'
const BASE_T = Date.parse(RECORDED_AT)
const DURATION_MS = 30_000

const seedBytes = createHash('sha256').update('multi-stream-seed').digest()
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

const iso = (offsetMs) => new Date(BASE_T + offsetMs).toISOString()

let frameCounter = 0
const nextFrameId = () => {
  frameCounter += 1
  return `f_multi_${frameCounter.toString(36)}`
}
let chatCounter = 0
const nextChatId = () => {
  chatCounter += 1
  return `c_multi_${chatCounter.toString(36)}`
}

const subscription = (stream, type, version = '1') => ({
  id: `sub_${stream.login}_${type}`,
  status: 'enabled',
  type,
  version,
  cost: 0,
  condition: { broadcaster_user_id: stream.broadcasterId, user_id: 'v_viewer' },
  transport: { method: 'websocket', session_id: `session-${stream.login}` },
  created_at: RECORDED_AT,
})

const TEXTS = [
  'love this',
  'gg',
  'insane',
  'pog',
  'that was clean',
  'LUL',
  'big moment',
  'so good',
  'wow',
  'incredible',
]

const buildChatFrame = (stream, offsetMs, userIdx) => ({
  t: iso(offsetMs),
  kind: 'notification',
  streamLogin: stream.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(offsetMs),
      subscription_type: 'channel.chat.message',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription(stream, 'channel.chat.message'),
      event: {
        broadcaster_user_id: stream.broadcasterId,
        broadcaster_user_login: stream.login,
        broadcaster_user_name: stream.name,
        chatter_user_id: `u_${stream.login}_${userIdx}`,
        chatter_user_login: `${stream.login}_u${userIdx}`,
        chatter_user_name: `${stream.login}_U${userIdx}`,
        message_id: nextChatId(),
        message: {
          text: TEXTS[Math.floor(rng() * TEXTS.length)],
          fragments: [{ type: 'text', text: TEXTS[Math.floor(rng() * TEXTS.length)] }],
        },
        color: '#66aaff',
        badges: [],
        message_type: 'text',
      },
    },
  },
})

const buildRaidFrame = (toStream, fromLogin, offsetMs) => ({
  t: iso(offsetMs),
  kind: 'notification',
  streamLogin: toStream.login,
  payload: {
    metadata: {
      message_id: nextFrameId(),
      message_type: 'notification',
      message_timestamp: iso(offsetMs),
      subscription_type: 'channel.raid',
      subscription_version: '1',
    },
    payload: {
      subscription: subscription(toStream, 'channel.raid'),
      event: {
        from_broadcaster_user_id: `b_${fromLogin}`,
        from_broadcaster_user_login: fromLogin,
        from_broadcaster_user_name: fromLogin,
        to_broadcaster_user_id: toStream.broadcasterId,
        to_broadcaster_user_login: toStream.login,
        to_broadcaster_user_name: toStream.name,
        viewers: 128,
      },
    },
  },
})

const frames = []

// Balanced chat volume across 3 streams: ~1 msg per stream every 1500 ms
// for 15 s (≈ 10 msgs per stream = 30 total).
for (let sec = 0; sec < 15; sec += 1) {
  // Each second emits ~2 messages per stream, staggered.
  for (let streamIdx = 0; streamIdx < STREAMS.length; streamIdx += 1) {
    const stream = STREAMS[streamIdx]
    const offsetMs = sec * 1000 + streamIdx * 300 + Math.floor(rng() * 100)
    frames.push(buildChatFrame(stream, offsetMs, Math.floor(rng() * 20)))
  }
}

// channel.raid on streamer_b at exactly 15 s.
frames.push(buildRaidFrame(STREAMS[1], 'raider_b', 15_000))

// Second half — continue balanced volume on all 3 streams through 30 s.
for (let sec = 15; sec < 30; sec += 1) {
  for (let streamIdx = 0; streamIdx < STREAMS.length; streamIdx += 1) {
    const stream = STREAMS[streamIdx]
    const offsetMs = sec * 1000 + streamIdx * 300 + Math.floor(rng() * 100)
    frames.push(buildChatFrame(stream, offsetMs, Math.floor(rng() * 20)))
  }
}

frames.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))

const header = {
  schemaVersion: 1,
  recordedAt: RECORDED_AT,
  recorderVersion: 'multi-stream-synthetic',
}

const lines = [JSON.stringify(header), ...frames.map((f) => JSON.stringify(f))]
writeFileSync(OUTPUT, lines.join('\n'))
console.log(`Wrote ${OUTPUT}: ${frames.length} frames, ${(lines.join('\n').length / 1024).toFixed(1)} KB, duration=${DURATION_MS}ms`)
