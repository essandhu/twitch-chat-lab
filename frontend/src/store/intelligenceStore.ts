import { create } from 'zustand'
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
import {
  extractBitsContext,
  extractCallouts,
  extractQuestions,
} from '../features/intelligence/SignalExtractor'
import { getAccountAge } from '../services/accountAgeService'

export const PRIMARY_STREAM_KEY = '__primary__'

const RECENT_CAP = 500
const EXTRACTED_CAP = 200
const HISTORY_CAP = 60
const TTR_WINDOW_MS = 60_000
const BASELINE_ALPHA = 0.02

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
  baselineTTR: number
  seenUserIds: Set<string>
}

interface IntelligenceStoreState {
  slices: Record<string, IntelligenceSlice>
  weightsOverride: Weights | null
  ingestMessage: (
    msg: ChatMessage,
    streamLogin?: string,
    broadcaster?: { login: string; displayName: string },
  ) => void
  tick: (nowMs: number, streamLogin?: string) => void
  reset: (streamLogin?: string) => void
  setAccountAge: (streamLogin: string, userId: string, record: AccountAgeRecord) => void
  setWeightsOverride: (weights: Weights | null) => void
}

const emptySignals: AnomalySignals = {
  similarityBurst: 0,
  lexicalDiversityDrop: 0,
  emoteVsTextRatio: 0,
  newChatterInflux: 0,
}

const createSlice = (): IntelligenceSlice => ({
  anomalySignals: { ...emptySignals },
  raidRiskScore: 0,
  raidBand: 'calm',
  extractedSignals: { questions: [], callouts: [], bitsContext: [] },
  accountAge: {},
  recentMessages: [],
  signalHistory: [],
  baselineTTR: 0,
  seenUserIds: new Set<string>(),
})

const keyFor = (login?: string): string => login ?? PRIMARY_STREAM_KEY

const pushCapped = <T>(arr: T[], next: T, cap: number): T[] => {
  const out = [...arr, next]
  if (out.length <= cap) return out
  return out.slice(out.length - cap)
}

const ttrForWindow = (messages: ChatMessage[], nowMs: number): number => {
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

export const useIntelligenceStore = create<IntelligenceStoreState>((set, get) => ({
  slices: {},
  weightsOverride: null,

  ingestMessage: (msg, streamLogin, broadcaster) => {
    const key = keyFor(streamLogin)
    const prev = get().slices[key] ?? createSlice()

    const nextRecent = pushCapped(prev.recentMessages, msg, RECENT_CAP)
    const nextExtracted = { ...prev.extractedSignals }
    const q = extractQuestions(msg)
    if (q) nextExtracted.questions = pushCapped(prev.extractedSignals.questions, q, EXTRACTED_CAP)
    if (broadcaster) {
      const c = extractCallouts(msg, broadcaster.login, broadcaster.displayName)
      if (c) nextExtracted.callouts = pushCapped(prev.extractedSignals.callouts, c, EXTRACTED_CAP)
    }
    const b = extractBitsContext(msg)
    if (b) nextExtracted.bitsContext = pushCapped(prev.extractedSignals.bitsContext, b, EXTRACTED_CAP)

    const nextSeen = new Set(prev.seenUserIds)
    nextSeen.add(msg.userId)

    set((state) => ({
      slices: { ...state.slices, [key]: { ...prev, recentMessages: nextRecent, extractedSignals: nextExtracted, seenUserIds: nextSeen } },
    }))

    if (!prev.accountAge[msg.userId]) {
      void getAccountAge(msg.userId).then((record) => {
        get().setAccountAge(key, msg.userId, record)
      })
    }
  },

  tick: (nowMs, streamLogin) => {
    const key = keyFor(streamLogin)
    const slice = get().slices[key]
    if (!slice) return

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

    const weights = get().weightsOverride ?? DEFAULT_WEIGHTS
    const score = computeRaidRiskScore(signals, weights)
    const band = bandFor(score)
    const history = pushCapped(slice.signalHistory, { t: nowMs, ...signals }, HISTORY_CAP)

    set((state) => ({
      slices: {
        ...state.slices,
        [key]: {
          ...slice,
          anomalySignals: signals,
          raidRiskScore: score,
          raidBand: band,
          signalHistory: history,
          baselineTTR: nextBaseline,
        },
      },
    }))
  },

  reset: (streamLogin) => {
    if (streamLogin === undefined) {
      set({ slices: {} })
      return
    }
    const key = keyFor(streamLogin)
    set((state) => {
      const next = { ...state.slices }
      delete next[key]
      return { slices: next }
    })
  },

  setAccountAge: (key, userId, record) => {
    set((state) => {
      const slice = state.slices[key]
      if (!slice) return state
      return {
        slices: {
          ...state.slices,
          [key]: { ...slice, accountAge: { ...slice.accountAge, [userId]: record } },
        },
      }
    })
  },

  setWeightsOverride: (weights) => set({ weightsOverride: weights }),
}))

export const useSliceFor = (login?: string): IntelligenceSlice | undefined =>
  useIntelligenceStore((s) => s.slices[keyFor(login)])

export const useRaidBand = (login?: string): RiskBand =>
  useIntelligenceStore((s) => s.slices[keyFor(login)]?.raidBand ?? 'calm')
