import type { AccountAgeBucket, ChatMessage } from '../../types/twitch'

// Refresh periodically — new accounts extend the upper bound. See architecture.md:1660 (Known Constraints).
const CALIBRATION: ReadonlyArray<{ userId: bigint; createdAt: string }> = [
  { userId: 1n, createdAt: '2007-05-12T00:00:00Z' },
  { userId: 1_000_000n, createdAt: '2010-03-01T00:00:00Z' },
  { userId: 10_000_000n, createdAt: '2012-06-01T00:00:00Z' },
  { userId: 30_000_000n, createdAt: '2013-09-01T00:00:00Z' },
  { userId: 100_000_000n, createdAt: '2015-11-01T00:00:00Z' },
  { userId: 200_000_000n, createdAt: '2018-06-01T00:00:00Z' },
  { userId: 400_000_000n, createdAt: '2020-03-01T00:00:00Z' },
  { userId: 600_000_000n, createdAt: '2021-05-01T00:00:00Z' },
  { userId: 800_000_000n, createdAt: '2022-10-01T00:00:00Z' },
  { userId: 1_000_000_000n, createdAt: '2024-06-01T00:00:00Z' },
  { userId: 90_000_000_000n, createdAt: '2026-04-15T00:00:00Z' },
]

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

export const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 0
  let intersect = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const item of small) if (big.has(item)) intersect++
  const union = a.size + b.size - intersect
  return union === 0 ? 0 : intersect / union
}

const normalizeToken = (raw: string): string => raw.toLowerCase().replace(/[.,!?;:]+$/u, '')

const tokenize = (text: string): string[] =>
  text.split(/\s+/u).map(normalizeToken).filter((t) => t.length > 0)

const ngramSet = (text: string): Set<string> => {
  const tokens = tokenize(text)
  if (tokens.length < 3) return new Set(tokens)
  const grams = new Set<string>()
  for (let i = 0; i + 3 <= tokens.length; i++) grams.add(`${tokens[i]}|${tokens[i + 1]}|${tokens[i + 2]}`)
  return grams
}

const messagesInWindow = (messages: ChatMessage[], nowMs: number, windowMs: number): ChatMessage[] =>
  messages.filter((m) => {
    const t = m.timestamp.getTime()
    return t > nowMs - windowMs && t <= nowMs
  })

export const similarityBurst = (
  messages: ChatMessage[],
  nowMs: number,
  windowMs: number = 10_000,
): number => {
  const window = messagesInWindow(messages, nowMs, windowMs)
  if (window.length < 2) return 0
  const grams = window.map((m) => ngramSet(m.text))
  const pairs: number[] = []
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) pairs.push(jaccardSimilarity(grams[i], grams[j]))
  }
  pairs.sort((a, b) => b - a)
  const top = pairs.slice(0, 5)
  if (top.length === 0) return 0
  const mean = top.reduce((a, b) => a + b, 0) / top.length
  return clamp01(mean)
}

export const lexicalDiversity = (
  messages: ChatMessage[],
  nowMs: number,
  baselineTTR: number,
  windowMs: number = 60_000,
): number => {
  if (baselineTTR === 0) return 0
  const window = messagesInWindow(messages, nowMs, windowMs)
  const tokens: string[] = []
  for (const m of window) tokens.push(...tokenize(m.text))
  if (tokens.length < 20) return 0
  const types = new Set(tokens).size
  const ttr = types / tokens.length
  const drop = 1 - ttr / baselineTTR
  return clamp01(drop)
}

export const emoteVsTextRatio = (
  messages: ChatMessage[],
  nowMs: number,
  windowMs: number = 30_000,
): number => {
  const window = messagesInWindow(messages, nowMs, windowMs)
  let emote = 0
  let total = 0
  for (const m of window) {
    for (const f of m.fragments) {
      total++
      if (f.type === 'emote') emote++
    }
  }
  if (total === 0) return 0
  return clamp01(emote / total)
}

export const newChatterInflux = (
  messages: ChatMessage[],
  seenBeforeWindow: Set<string>,
  nowMs: number,
  windowMs: number = 30_000,
): number => {
  const window = messagesInWindow(messages, nowMs, windowMs)
  if (window.length === 0) return 0
  const fresh = new Set<string>()
  for (const m of window) if (!seenBeforeWindow.has(m.userId)) fresh.add(m.userId)
  return clamp01(fresh.size / window.length)
}

const bucketFromDays = (days: number): AccountAgeBucket => {
  if (days < 30) return 'new'
  if (days < 365) return 'recent'
  return 'established'
}

export const accountAgeBucket = (userId: string): AccountAgeBucket => {
  if (!/^\d+$/.test(userId)) return 'unknown'
  const id = BigInt(userId)
  // Log-linear interpolation between calibration datapoints (id is monotonic with creation time).
  let lo = CALIBRATION[0]
  let hi = CALIBRATION[CALIBRATION.length - 1]
  for (let i = 0; i < CALIBRATION.length - 1; i++) {
    const a = CALIBRATION[i]
    const b = CALIBRATION[i + 1]
    if (id >= a.userId && id <= b.userId) {
      lo = a
      hi = b
      break
    }
  }
  if (id <= lo.userId) return bucketFromDays(daysSince(lo.createdAt))
  if (id >= hi.userId) return bucketFromDays(daysSince(hi.createdAt))
  const loLn = Math.log(Number(lo.userId > 0n ? lo.userId : 1n))
  const hiLn = Math.log(Number(hi.userId))
  const idLn = Math.log(Number(id))
  const frac = (idLn - loLn) / (hiLn - loLn)
  const loMs = Date.parse(lo.createdAt)
  const hiMs = Date.parse(hi.createdAt)
  const estMs = loMs + frac * (hiMs - loMs)
  const days = (Date.now() - estMs) / 86_400_000
  return bucketFromDays(days)
}

const daysSince = (iso: string): number => (Date.now() - Date.parse(iso)) / 86_400_000
