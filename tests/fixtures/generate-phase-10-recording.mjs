#!/usr/bin/env node
// Generator for tests/fixtures/phase-10-recording.jsonl.
// Phase 10: single-stream 90s session.
//   0–60s: baseline 3 msg/s, 6 distinct users.
//   60–75s: semantic-cluster burst — 30 messages about "boss fight" vocab (2 msg/s).
//   75–85s: spike — 10 s of 12 msg/s noise (triggers `spike` Moment).
//   85–90s: decay back to baseline.
// Schema matches Phase 8/9 (see tests/fixtures/README.md). Deterministic via sha256('phase-10-seed').

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(__dirname, 'phase-10-recording.jsonl')

const STREAM = { login: 'alpha', name: 'Alpha', broadcasterId: 'b_alpha' }
const RECORDED_AT = '2026-04-21T00:00:00Z'

const seedBytes = createHash('sha256').update('phase-10-seed').digest()
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

const chatEvent = (user, text) => ({
  broadcaster_user_id: `uid_${STREAM.login}`,
  broadcaster_user_login: STREAM.login,
  broadcaster_user_name: STREAM.name,
  chatter_user_id: user.id,
  chatter_user_login: user.login,
  chatter_user_name: user.name,
  message_id: `c_${(rng() * 1e9).toFixed(0)}_${user.id}`,
  message: { text, fragments: [{ type: 'text', text }] },
  color: '#66aaff',
  badges: [],
  message_type: 'text',
})

const envelope = (event) => ({ subscription_type: 'channel.chat.message', event })

const GENERIC = [
  'gg nice',
  'clean play',
  'love this',
  'lets go',
  'chat vibes',
  'one more round',
  'welcome',
  'nice execution',
]

const BOSS_VOCAB = [
  'boss fight incoming',
  'here comes the boss',
  'boss fight go',
  'watch the boss phase 2',
  'boss phase 3 incoming',
  'dodge the boss attack',
  'heal up for boss',
  'boss is almost dead',
  'boss fight is intense',
  'boss attack pattern',
  'boss fight time',
  'boss low hp now',
]

const NOISE = ['aaa', 'lol', 'pog', 'wow', 'huh', 'omg', 'nice', 'gg']

const users = Array.from({ length: 6 }, (_, i) => ({
  id: `u_${STREAM.login}_${i}`,
  login: `${STREAM.login}_u${i}`,
  name: `${STREAM.login}_U${i}`,
}))

const frames = []
frames.push({ schemaVersion: 1, recordedAt: RECORDED_AT, recorderVersion: 'phase-10-synthetic' })

// 0–60s baseline @ 1 msg/s (60 msgs)
for (let t = 0; t < 60_000; t += 1000) {
  frames.push({
    t,
    kind: 'notification',
    streamLogin: STREAM.login,
    payload: envelope(chatEvent(pick(users), pick(GENERIC))),
  })
}

// 60–75s boss-fight cluster @ 2 msg/s (30 msgs)
for (let i = 0; i < 30; i++) {
  const t = 60_000 + i * 500
  frames.push({
    t,
    kind: 'notification',
    streamLogin: STREAM.login,
    payload: envelope(chatEvent(pick(users), pick(BOSS_VOCAB))),
  })
}

// 75–85s spike @ 6 msg/s (60 msgs — still > 2× baseline avg of ~1/s, triggers spike rule)
for (let i = 0; i < 60; i++) {
  const t = 75_000 + Math.floor((i / 60) * 10_000)
  frames.push({
    t,
    kind: 'notification',
    streamLogin: STREAM.login,
    payload: envelope(chatEvent(pick(users), pick(NOISE))),
  })
}

// 85–90s decay @ 1 msg/s (5 msgs)
for (let t = 85_000; t < 90_000; t += 1000) {
  frames.push({
    t,
    kind: 'notification',
    streamLogin: STREAM.login,
    payload: envelope(chatEvent(pick(users), pick(GENERIC))),
  })
}

const out = frames.map((f) => JSON.stringify(f)).join('\n') + '\n'
writeFileSync(OUTPUT, out, 'utf8')
console.log(`Wrote ${frames.length} frames (${out.length} bytes) to ${OUTPUT}`)
