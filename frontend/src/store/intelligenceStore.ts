import { create } from 'zustand'
import type { AccountAgeRecord, ChatMessage } from '../types/twitch'
import type { RiskBand } from '../features/filters/filterQueryTokens'
import type { Weights } from '../features/intelligence/raidRiskScore'
import {
  extractBitsContext,
  extractCallouts,
  extractQuestions,
} from '../features/intelligence/SignalExtractor'
import { getAccountAge } from '../services/accountAgeService'
import {
  PRIMARY_STREAM_KEY as _PRIMARY_STREAM_KEY,
  RECENT_CAP,
  EXTRACTED_CAP,
  computeTickUpdate,
  createSlice,
  keyFor,
  pushCapped,
  type IntelligenceSlice,
} from './intelligenceStoreCompute'

export const PRIMARY_STREAM_KEY = _PRIMARY_STREAM_KEY
export type { IntelligenceSlice }

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
      slices: {
        ...state.slices,
        [key]: { ...prev, recentMessages: nextRecent, extractedSignals: nextExtracted, seenUserIds: nextSeen },
      },
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

    const update = computeTickUpdate(slice, nowMs, get().weightsOverride)

    set((state) => ({
      slices: { ...state.slices, [key]: { ...slice, ...update } },
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
