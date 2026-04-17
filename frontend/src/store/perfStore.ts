import { create } from 'zustand'
import type { PerfMetrics } from '../types/twitch'

const INITIAL_METRICS: PerfMetrics = {
  messagesRenderedPerSec: 0,
  domNodeCount: 0,
  jsHeapUsedMB: null,
  eventSubLatencyMs: 0,
  virtualizerRenderMs: 0,
}

interface PerfStoreState {
  metrics: PerfMetrics
  isVisible: boolean
  updateMetrics: (partial: Partial<PerfMetrics>) => void
  toggleVisibility: () => void
  reset: () => void
}

export const usePerfStore = create<PerfStoreState>((set) => ({
  metrics: { ...INITIAL_METRICS },
  isVisible: false,
  updateMetrics: (partial) => set((state) => ({ metrics: { ...state.metrics, ...partial } })),
  toggleVisibility: () => set((state) => ({ isVisible: !state.isVisible })),
  reset: () => set({ metrics: { ...INITIAL_METRICS }, isVisible: false }),
}))
