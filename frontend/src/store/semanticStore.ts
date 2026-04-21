import { create } from 'zustand'
import type { ChatMessage, Moment, SemanticSearchResult } from '../types/twitch'
import { detectMoments as detectMomentsPure } from '../features/semantic/detectMoments'
import { topK } from '../features/semantic/cosineSim'
import {
  EmbeddingService,
  getEmbeddingService,
  type EmbeddingStatus,
} from '../services/EmbeddingService'
import { PRIMARY_STREAM_KEY } from './intelligenceStoreCompute'
import { useHeatmapStore } from './heatmapStore'
import { useIntelligenceStore } from './intelligenceStore'

const MOMENTS_CAP = 200

export type SemanticStatus = EmbeddingStatus

interface SemanticStoreState {
  isActivated: boolean
  activationByStream: Record<string, boolean>
  status: SemanticStatus
  embeddings: Record<string, Float32Array>
  embeddingTimestamps: Record<string, number>
  moments: Moment[]
  searchQuery: string
  searchResults: SemanticSearchResult[]
  lastSearchAt: number

  activate: (streamLogin?: string) => Promise<void>
  ingestMessage: (msg: ChatMessage, streamLogin?: string, now?: number) => void
  setSearchQuery: (q: string) => void
  runSearch: (now: number) => Promise<void>
  detectMoments: (now: number) => void
  reset: () => void

  _service: EmbeddingService | null
  _statusUnsub: (() => void) | null
}

const capMoments = (current: Moment[], incoming: Moment[]): Moment[] => {
  const byId = new Map<string, Moment>()
  for (const m of current) byId.set(m.id, m)
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m)
  const all = Array.from(byId.values()).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  return all.length <= MOMENTS_CAP ? all : all.slice(all.length - MOMENTS_CAP)
}

export const useSemanticStore = create<SemanticStoreState>((set, get) => ({
  isActivated: false,
  activationByStream: {},
  status: 'idle',
  embeddings: {},
  embeddingTimestamps: {},
  moments: [],
  searchQuery: '',
  searchResults: [],
  lastSearchAt: 0,
  _service: null,
  _statusUnsub: null,

  activate: async (streamLogin) => {
    const key = streamLogin ?? PRIMARY_STREAM_KEY
    set((s) => ({
      isActivated: true,
      activationByStream: { ...s.activationByStream, [key]: true },
    }))
    const svc = get()._service ?? getEmbeddingService()
    if (!get()._service) {
      const unsub = svc.onStatus((status) => set({ status }))
      set({ _service: svc, _statusUnsub: unsub })
    }
    try {
      await svc.warm()
    } catch {
      // status subscription already reflects failure
    }
  },

  ingestMessage: (msg, streamLogin, now) => {
    const key = streamLogin ?? PRIMARY_STREAM_KEY
    if (get().activationByStream[key] !== true) return
    if (get().status !== 'ready') return
    const svc = get()._service
    if (!svc) return
    const t = now ?? msg.timestamp.getTime()
    void svc
      .embedBatch([{ messageId: msg.id, text: msg.text }])
      .then((records) => {
        if (records.length === 0) return
        const rec = records[0]
        set((s) => ({
          embeddings: { ...s.embeddings, [rec.messageId]: rec.vector },
          embeddingTimestamps: { ...s.embeddingTimestamps, [rec.messageId]: t },
        }))
      })
      .catch(() => {
        /* fatal already surfaces via status subscription */
      })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  runSearch: async (now) => {
    const query = get().searchQuery.trim()
    if (query.length < 2) {
      set({ searchResults: [], lastSearchAt: now })
      return
    }
    const svc = get()._service
    if (!svc || get().status !== 'ready') {
      set({ searchResults: [], lastSearchAt: now })
      return
    }
    const queryVec = await svc.embed(query)
    const entries = Object.entries(get().embeddings).map(([messageId, vector]) => ({ messageId, vector }))
    const results = topK(queryVec, entries, 20)
    set({ searchResults: results, lastSearchAt: now })
  },

  detectMoments: (now) => {
    const heatmap = useHeatmapStore.getState()
    const intel = useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]
    const embeddings = Object.entries(get().embeddings).map(([messageId, vector]) => ({
      messageId,
      vector,
      t: get().embeddingTimestamps[messageId] ?? 0,
    }))
    const existing = new Set(get().moments.map((m) => m.id))
    const produced = detectMomentsPure({
      now,
      heatmap: {
        dataPoints: heatmap.dataPoints ?? [],
        annotations: heatmap.annotations ?? [],
        rollingAverage30s: heatmap.rollingAverage30s ?? 0,
      },
      intelligence: {
        emoteVsTextRatio: intel?.anomalySignals.emoteVsTextRatio ?? 0,
        emoteVsTextHistory: intel?.emoteVsTextHistory ?? [],
        questions: intel?.extractedSignals.questions ?? [],
      },
      embeddings,
      existingMomentIds: existing,
    })
    if (produced.length === 0) return
    set((s) => ({ moments: capMoments(s.moments, produced) }))
  },

  reset: () => {
    const unsub = get()._statusUnsub
    if (unsub) unsub()
    set({
      isActivated: false,
      activationByStream: {},
      status: 'idle',
      embeddings: {},
      embeddingTimestamps: {},
      moments: [],
      searchQuery: '',
      searchResults: [],
      lastSearchAt: 0,
      _service: null,
      _statusUnsub: null,
    })
  },
}))
