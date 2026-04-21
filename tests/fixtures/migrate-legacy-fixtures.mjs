#!/usr/bin/env node
// P11-14 — migrates Phase 8/9/10 legacy fixtures to the Phase 11 canonical
// schema:
//
//   legacy: t: <ms-offset> (number)            → canonical: t: <ISO-8601>
//   legacy: payload: { subscription_type,      → canonical: payload: {
//                      event }                              metadata: { ... },
//                                                           payload: { subscription, event } }
//
// The anchor timestamp is `header.recordedAt`; frame t offsets are added to it.
//
// Usage: node tests/fixtures/migrate-legacy-fixtures.mjs [<filename>...]
// Default: migrate all *.jsonl in this dir whose first frame has numeric t.
//
// Overwrites the file in place. Intended as a one-shot — after migration,
// the canonical validateSchema.test.mjs validates all fixtures.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = __dirname

const buildMetadata = (t, subscriptionType, messageIndex) => ({
  message_id: `legacy_${messageIndex.toString(36)}`,
  message_type: 'notification',
  message_timestamp: t,
  subscription_type: subscriptionType,
  subscription_version: '1',
})

const buildSubscription = (subscriptionType, streamLogin) => ({
  id: `legacy_sub_${streamLogin}_${subscriptionType}`,
  status: 'enabled',
  type: subscriptionType,
  version: '1',
  cost: 0,
  condition: { broadcaster_user_id: `legacy_${streamLogin}` },
  transport: { method: 'websocket', session_id: `legacy-${streamLogin}` },
  created_at: t,
})

const migrateFrame = (frame, baseIso, messageIndex) => {
  if (typeof frame.t !== 'number') return frame // already canonical
  const iso = new Date(Date.parse(baseIso) + frame.t).toISOString()

  // Legacy payload shape: { subscription_type, event }
  // Canonical payload: { metadata, payload: { subscription, event } }
  const legacyPayload = frame.payload
  const subscriptionType = legacyPayload?.subscription_type ?? 'channel.chat.message'
  const event = legacyPayload?.event ?? {}

  return {
    t: iso,
    kind: frame.kind,
    streamLogin: frame.streamLogin,
    payload: {
      metadata: {
        message_id: `legacy_${messageIndex.toString(36)}`,
        message_type: 'notification',
        message_timestamp: iso,
        subscription_type: subscriptionType,
        subscription_version: '1',
      },
      payload: {
        subscription: {
          id: `legacy_sub_${frame.streamLogin}_${subscriptionType}`,
          status: 'enabled',
          type: subscriptionType,
          version: '1',
          cost: 0,
          condition: { broadcaster_user_id: `legacy_${frame.streamLogin}` },
          transport: { method: 'websocket', session_id: `legacy-${frame.streamLogin}` },
          created_at: iso,
        },
        event,
      },
    },
  }
}

const migrateFixture = (filepath) => {
  const content = readFileSync(filepath, 'utf8')
  const lines = content.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return { migrated: false, reason: 'empty' }
  const header = JSON.parse(lines[0])
  const baseIso = header.recordedAt

  const firstFrame = lines.length > 1 ? JSON.parse(lines[1]) : null
  if (!firstFrame || typeof firstFrame.t !== 'number') {
    return { migrated: false, reason: 'already canonical or empty' }
  }

  const migratedFrames = lines.slice(1).map((line, idx) => {
    const frame = JSON.parse(line)
    return migrateFrame(frame, baseIso, idx)
  })

  const output = [JSON.stringify(header), ...migratedFrames.map((f) => JSON.stringify(f))].join('\n')
  writeFileSync(filepath, output)
  return { migrated: true, frameCount: migratedFrames.length }
}

const main = () => {
  const argv = process.argv.slice(2)
  const targets = argv.length > 0
    ? argv.map((a) => join(FIXTURES_DIR, a))
    : readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(FIXTURES_DIR, f))
  let migrated = 0
  for (const file of targets) {
    const result = migrateFixture(file)
    if (result.migrated) {
      console.log(`✓ migrated ${file} (${result.frameCount} frames)`)
      migrated += 1
    } else {
      console.log(`- skipped ${file}: ${result.reason}`)
    }
  }
  console.log(`\n${migrated} fixtures migrated`)
}

const isDirect = process.argv[1] && process.argv[1].endsWith('migrate-legacy-fixtures.mjs')
if (isDirect) main()
