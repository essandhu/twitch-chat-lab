#!/usr/bin/env node
// Generator for tests/fixtures/phase-9-recording.jsonl.
// Phase 9: 3-stream 60s session with a copypasta burst on 'alpha' at t=40s (40 msgs over 5 s).
// Schema matches Phase 8 (see tests/fixtures/README.md).

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(__dirname, 'phase-9-recording.jsonl')

const STREAMS = [
  { login: 'alpha', name: 'Alpha', broadcasterId: 'b_alpha' },
  { login: 'beta', name: 'Beta', broadcasterId: 'b_beta' },
  { login: 'gamma', name: 'Gamma', broadcasterId: 'b_gamma' },
]
const RECORDED_AT = '2026-04-20T00:00:00Z'

const seedBytes = createHash('sha256').update('phase-9-seed').digest()
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
const pick = (arr) => arr[Math.floor(rng() * arr.length)]

const subscriberBadge = { set_id: 'subscriber', id: '1', info: '3' }

const chatEvent = (stream, user, text, opts = {}) => {
  const fragments = opts.fragments ?? [{ type: 'text', text }]
  const event = {
    broadcaster_user_id: `uid_${stream.login}`,
    broadcaster_user_login: stream.login,
    broadcaster_user_name: stream.name,
    chatter_user_id: user.id,
    chatter_user_login: user.login,
    chatter_user_name: user.name,
    message_id: `c_${(rng() * 1e9).toFixed(0)}_${user.id}`,
    message: { text, fragments },
    color: opts.color ?? '#66aaff',
    badges: opts.badges ?? [],
    message_type: opts.messageType ?? 'text',
  }
  if (opts.cheer) event.cheer = opts.cheer
  return event
}

const envelope = (event, type = 'channel.chat.message') => ({ subscription_type: type, event })

const GENERIC = [
  'gg nice game',
  'that was clean play',
  'insane reaction time',
  'love this stream',
  'chat vibes are good',
  'coffee time soon',
  'one more round',
  'this map is a mess',
  'audio is perfect today',
  'welcome newcomer',
  'keyboard too loud',
  'nice execution',
  'i feel that pain',
  'lets gooo',
]
const QUESTIONS = [
  'how did you hit that shot',
  'what time does the next match start',
  'why is the screen blurry today',
  'where can i get the pack',
  'who is playing next round',
  'is this your first stream today',
]
const CALLOUTS = {
  alpha: 'big fan @alpha keep it up',
  beta: 'gg @beta that dodge was wild',
  gamma: 'hey @gamma stream sounds clean',
}
const COPYPASTA = 'HAHAHA COPYPASTA GO BRRRR yes'

const users = STREAMS.flatMap((s) =>
  Array.from({ length: 30 }, (_, i) => ({
    id: `u_${s.login}_${i}`,
    login: `${s.login}_u${i}`,
    name: `${s.login}_U${i}`,
  })),
)
const usersFor = (login) => users.filter((u) => u.id.startsWith(`u_${login}_`))

const frames = []
const header = { schemaVersion: 1, recordedAt: RECORDED_AT, recorderVersion: 'phase-9-synthetic' }
frames.push(header)

const questionCounts = new Map()
const calloutCounts = new Map()
let bitsCount = 0

// 0-40s baseline 1 msg/s/stream
for (let t = 0; t < 40_000; t += 1000) {
  for (const stream of STREAMS) {
    const u = pick(usersFor(stream.login))
    let text = pick(GENERIC)
    const opts = {}
    if ((questionCounts.get(stream.login) ?? 0) < 2 && rng() < 0.14) {
      text = pick(QUESTIONS)
      questionCounts.set(stream.login, (questionCounts.get(stream.login) ?? 0) + 1)
    } else if ((calloutCounts.get(stream.login) ?? 0) < 1 && rng() < 0.12) {
      text = CALLOUTS[stream.login]
      calloutCounts.set(stream.login, (calloutCounts.get(stream.login) ?? 0) + 1)
    } else if (bitsCount < 2 && rng() < 0.05) {
      opts.cheer = { bits: bitsCount === 0 ? 100 : 500 }
      text = `cheer${opts.cheer.bits} thanks for the stream`
      bitsCount++
    }
    if (rng() < 0.3) opts.badges = [subscriberBadge]
    frames.push({
      t,
      kind: 'notification',
      streamLogin: stream.login,
      payload: envelope(chatEvent(stream, u, text, opts)),
    })
  }
}

// 40-45s copypasta burst on alpha (40 messages over 5s)
for (let i = 0; i < 40; i++) {
  const t = 40_000 + i * 125
  const u = { id: `raider_${i}`, login: `raider_${i}`, name: `raider_${i}` }
  frames.push({
    t,
    kind: 'notification',
    streamLogin: 'alpha',
    payload: envelope(chatEvent(STREAMS[0], u, COPYPASTA)),
  })
}

// 45-60s baseline resumes
for (let t = 45_000; t < 60_000; t += 1000) {
  for (const stream of STREAMS) {
    const u = pick(usersFor(stream.login))
    let text = pick(GENERIC)
    const opts = {}
    if ((questionCounts.get(stream.login) ?? 0) < 3 && rng() < 0.1) {
      text = pick(QUESTIONS)
      questionCounts.set(stream.login, (questionCounts.get(stream.login) ?? 0) + 1)
    }
    if (rng() < 0.3) opts.badges = [subscriberBadge]
    frames.push({
      t,
      kind: 'notification',
      streamLogin: stream.login,
      payload: envelope(chatEvent(stream, u, text, opts)),
    })
  }
}

const headerFrame = frames[0]
frames.sort((a, b) => {
  if (a === headerFrame) return -1
  if (b === headerFrame) return 1
  return a.t - b.t
})

const lines = frames.map((f) => JSON.stringify(f)).join('\n') + '\n'
writeFileSync(OUTPUT, lines, 'utf8')
const sizeKb = Buffer.byteLength(lines, 'utf8') / 1024
console.log(
  `Wrote ${frames.length} frames (${sizeKb.toFixed(1)} KB) questions=${JSON.stringify(Object.fromEntries(questionCounts))} callouts=${JSON.stringify(
    Object.fromEntries(calloutCounts),
  )} bits=${bitsCount}`,
)
