#!/usr/bin/env node
// P11-14 — Phase 11 fixture schema validator.
// Validates every tests/fixtures/*.jsonl against the RecordedFrame schema
// defined in frontend/src/types/recording.ts (SCHEMA_VERSION = 1, RecordedFrame
// shape). Runs as a Node script:
//
//   node tests/fixtures/validateSchema.test.mjs
//
// Also runs as a Vitest test via tests/fixtures/validateSchema.test.ts
// which imports this script's logic. For now, this file is the authoritative
// validator invoked by `npm run test:fixtures` (wired into package.json if
// absent).

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = __dirname

const SCHEMA_VERSION = 1
const VALID_KINDS = new Set([
  'session_welcome',
  'notification',
  'session_keepalive',
  'session_reconnect',
  'revocation',
])

const isIsoDate = (s) => {
  if (typeof s !== 'string') return false
  const parsed = Date.parse(s)
  if (!Number.isFinite(parsed)) return false
  // Require the ISO-8601 format (not numeric or other accepted Date.parse inputs).
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)
}

const validateHeader = (line, filepath) => {
  let header
  try {
    header = JSON.parse(line)
  } catch (err) {
    return { ok: false, error: `${filepath}:1 header is not valid JSON: ${err.message}` }
  }
  if (typeof header !== 'object' || header === null) {
    return { ok: false, error: `${filepath}:1 header is not an object` }
  }
  if (header.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `${filepath}:1 header.schemaVersion: expected ${SCHEMA_VERSION}, got ${header.schemaVersion}`,
    }
  }
  if (!isIsoDate(header.recordedAt)) {
    return { ok: false, error: `${filepath}:1 header.recordedAt is not ISO-8601: ${header.recordedAt}` }
  }
  if (typeof header.recorderVersion !== 'string' || header.recorderVersion.length === 0) {
    return { ok: false, error: `${filepath}:1 header.recorderVersion must be non-empty string` }
  }
  return { ok: true, header }
}

const validateFrame = (line, filepath, lineNo) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch (err) {
    return { ok: false, error: `${filepath}:${lineNo} frame is not valid JSON: ${err.message}` }
  }
  if (!isIsoDate(frame.t)) {
    return { ok: false, error: `${filepath}:${lineNo} frame.t is not ISO-8601: ${JSON.stringify(frame.t)}` }
  }
  if (!VALID_KINDS.has(frame.kind)) {
    return { ok: false, error: `${filepath}:${lineNo} frame.kind invalid: ${frame.kind}` }
  }
  if (typeof frame.streamLogin !== 'string') {
    return { ok: false, error: `${filepath}:${lineNo} frame.streamLogin must be a string` }
  }
  if (!('payload' in frame)) {
    return { ok: false, error: `${filepath}:${lineNo} frame missing payload` }
  }
  return { ok: true, frame }
}

export const validateFixture = (filepath) => {
  const content = readFileSync(filepath, 'utf8')
  const lines = content.split('\n')
  if (lines.length === 0 || lines[0] === '') {
    return [`${filepath} is empty`]
  }
  const errors = []
  const headerResult = validateHeader(lines[0], filepath)
  if (!headerResult.ok) {
    errors.push(headerResult.error)
    return errors // header errors mean we can't trust the rest
  }

  const frameLines = lines.slice(1).filter((l) => l.length > 0)
  if (frameLines.length === 0) {
    errors.push(`${filepath} has no frames (empty recording)`)
    return errors
  }

  let prevT = -Infinity
  for (let i = 0; i < frameLines.length; i += 1) {
    const lineNo = i + 2
    const result = validateFrame(frameLines[i], filepath, lineNo)
    if (!result.ok) {
      errors.push(result.error)
      continue
    }
    const t = Date.parse(result.frame.t)
    if (t < prevT) {
      errors.push(
        `${filepath}:${lineNo} frame.t (${result.frame.t}) is earlier than previous frame (non-monotonic)`,
      )
    }
    prevT = t
  }
  return errors
}

const main = () => {
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
  if (files.length === 0) {
    console.error('no .jsonl fixtures found')
    process.exit(1)
  }
  let totalErrors = 0
  for (const f of files) {
    const errors = validateFixture(join(FIXTURES_DIR, f))
    if (errors.length === 0) {
      console.log(`✓ ${f}`)
    } else {
      console.log(`✗ ${f}`)
      for (const err of errors) console.log(`  ${err}`)
      totalErrors += errors.length
    }
  }
  if (totalErrors > 0) {
    console.error(`\n${totalErrors} schema error${totalErrors === 1 ? '' : 's'}`)
    process.exit(1)
  }
  console.log(`\n${files.length} fixtures valid`)
}

// Allow both direct node invocation and import for tests.
const isDirect = process.argv[1] && process.argv[1].endsWith('validateSchema.test.mjs')
if (isDirect) main()
