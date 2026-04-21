import type {
  AccountAgeRecord,
  AnomalySignals,
  ChatMessage,
  ExtractedSignalRef,
} from '../types/twitch'
import type { RiskBand } from '../features/filters/filterQueryTokens'
import type { Weights } from '../features/intelligence/raidRiskScore'
import { bandFor, computeRaidRiskScore, DEFAULT_WEIGHTS } from '../features/intelligence/raidRiskScore'
import {
  emoteVsTextRatio,
  lexicalDiversity,
  newChatterInflux,
  similarityBurst,
} from '../features/intelligence/signalMath'

export const PRIMARY_STREAM_KEY = '__primary__'

export const RECENT_CAP = 500
export const EXTRACTED_CAP = 200
export const HISTORY_CAP = 60
export const TTR_WINDOW_MS = 60_000
export const BASELINE_ALPHA = 0.02

export interface IntelligenceSlice {
  anomalySignals: AnomalySignals
  raidRiskScore: number
  raidBand: RiskBand
  extractedSignals: {
    questions: ExtractedSignalRef[]
    callouts: ExtractedSignalRef[]
    bitsContext: ExtractedSignalRef[]
  }
  accountAge: Record<string, AccountAgeRecord>
  recentMessages: ChatMessage[]
  signalHistory: Array<{ t: number } & AnomalySignals>
  emoteVsTextHistory: Array<{ t: number; v: number }>
  baselineTTR: number
  seenUserIds: Set<string>
}

export const emptySignals: AnomalySignals = {
  similarityBurst: 0,
  lexicalDiversityDrop: 0,
  emoteVsTextRatio: 0,
  newChatterInflux: 0,
}

export const createSlice = (): IntelligenceSlice => ({
  anomalySignals: { ...emptySignals },
  raidRiskScore: 0,
  raidBand: 'calm',
  extractedSignals: { questions: [], callouts: [], bitsContext: [] },
  accountAge: {},
  recentMessages: [],
  signalHistory: [],
  emoteVsTextHistory: [],
  baselineTTR: 0,
  seenUserIds: new Set<string>(),
})

/** 10-minute rolling emote-vs-text history — P10-08 retention (600 samples at 1 Hz). */
export const appendEmoteVsTextSample = (
  history: Array<{ t: number; v: number }>,
  sample: { t: number; v: number },
  maxSamples = 600,
): Array<{ t: number; v: number }> => pushCapped(history, sample, maxSamples)

export const keyFor = (login?: string): string => login ?? PRIMARY_STREAM_KEY

export const pushCapped = <T>(arr: T[], next: T, cap: number): T[] => {
  const out = [...arr, next]
  if (out.length <= cap) return out
  return out.slice(out.length - cap)
}

export const ttrForWindow = (messages: ChatMessage[], nowMs: number): number => {
  const tokens: string[] = []
  for (const m of messages) {
    if (m.timestamp.getTime() <= nowMs - TTR_WINDOW_MS) continue
    for (const f of m.fragments) if (f.type === 'text') {
      for (const t of f.text.split(/\s+/u)) if (t.length > 0) tokens.push(t.toLowerCase())
    }
  }
  if (tokens.length === 0) return 0
  return new Set(tokens).size / tokens.length
}

export interface TickUpdate {
  anomalySignals: AnomalySignals
  raidRiskScore: number
  raidBand: RiskBand
  signalHistory: Array<{ t: number } & AnomalySignals>
  emoteVsTextHistory: Array<{ t: number; v: number }>
  baselineTTR: number
}

export const computeTickUpdate = (
  slice: IntelligenceSlice,
  nowMs: number,
  weightsOverride: Weights | null,
): TickUpdate => {
  const seenBefore = new Set<string>()
  for (const m of slice.recentMessages) {
    if (m.timestamp.getTime() <= nowMs - 30_000) seenBefore.add(m.userId)
  }

  const windowTTR = ttrForWindow(slice.recentMessages, nowMs)
  const nextBaseline =
    slice.baselineTTR === 0
      ? windowTTR
      : slice.baselineTTR * (1 - BASELINE_ALPHA) + windowTTR * BASELINE_ALPHA

  const signals: AnomalySignals = {
    similarityBurst: similarityBurst(slice.recentMessages, nowMs),
    lexicalDiversityDrop: lexicalDiversity(slice.recentMessages, nowMs, nextBaseline || 1e-9),
    emoteVsTextRatio: emoteVsTextRatio(slice.recentMessages, nowMs),
    newChatterInflux: newChatterInflux(slice.recentMessages, seenBefore, nowMs),
  }

  const weights = weightsOverride ?? DEFAULT_WEIGHTS
  const score = computeRaidRiskScore(signals, weights)
  const band = bandFor(score)
  const signalHistory = pushCapped(slice.signalHistory, { t: nowMs, ...signals }, HISTORY_CAP)
  const emoteVsTextHistory = appendEmoteVsTextSample(slice.emoteVsTextHistory, { t: nowMs, v: signals.emoteVsTextRatio })

  return {
    anomalySignals: signals,
    raidRiskScore: score,
    raidBand: band,
    signalHistory,
    emoteVsTextHistory,
    baselineTTR: nextBaseline,
  }
}
