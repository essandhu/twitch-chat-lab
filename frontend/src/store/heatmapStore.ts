import { create } from 'zustand'
import type { EventAnnotation, HeatmapDataPoint } from '../types/twitch'

const ROLLING_WINDOW_POINTS = 300 // 5 minutes at 1-second cadence
const ROLLING_AVERAGE_POINTS = 30 // 30 seconds
const SPIKE_MULTIPLIER = 2

interface HeatmapStoreState {
  dataPoints: HeatmapDataPoint[]
  annotations: EventAnnotation[]
  currentMsgPerSec: number
  peakMsgPerSec: number
  rollingAverage30s: number
  _counter: number

  incrementCounter: () => void
  tick: () => void
  addAnnotation: (annotation: EventAnnotation) => void
  reset: () => void
  isDuringSpike: (timestamp: number) => boolean
}

const average = (values: number[]): number => {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

const findClosestPrecedingPoint = (
  points: HeatmapDataPoint[],
  timestamp: number,
): HeatmapDataPoint | null => {
  let candidate: HeatmapDataPoint | null = null
  for (const p of points) {
    if (p.timestamp > timestamp) break
    candidate = p
  }
  return candidate
}

export const useHeatmapStore = create<HeatmapStoreState>((set, get) => ({
  dataPoints: [],
  annotations: [],
  currentMsgPerSec: 0,
  peakMsgPerSec: 0,
  rollingAverage30s: 0,
  _counter: 0,

  incrementCounter: () => set((state) => ({ _counter: state._counter + 1 })),

  tick: () =>
    set((state) => {
      const msgPerSec = state._counter
      const timestamp = Math.round(Date.now() / 1000) * 1000
      const nextPoint: HeatmapDataPoint = { timestamp, msgPerSec }

      const appended = [...state.dataPoints, nextPoint]
      const trimmed =
        appended.length > ROLLING_WINDOW_POINTS
          ? appended.slice(appended.length - ROLLING_WINDOW_POINTS)
          : appended

      const rollingSlice = trimmed.slice(-ROLLING_AVERAGE_POINTS)
      const rollingAverage30s = average(rollingSlice.map((p) => p.msgPerSec))

      return {
        _counter: 0,
        currentMsgPerSec: msgPerSec,
        peakMsgPerSec: Math.max(state.peakMsgPerSec, msgPerSec),
        dataPoints: trimmed,
        rollingAverage30s,
      }
    }),

  addAnnotation: (annotation) =>
    set((state) => ({ annotations: [...state.annotations, annotation] })),

  reset: () =>
    set({
      dataPoints: [],
      annotations: [],
      currentMsgPerSec: 0,
      peakMsgPerSec: 0,
      rollingAverage30s: 0,
      _counter: 0,
    }),

  isDuringSpike: (timestamp) => {
    const { dataPoints, rollingAverage30s } = get()
    if (dataPoints.length === 0) return false
    if (rollingAverage30s === 0) return false
    const point = findClosestPrecedingPoint(dataPoints, timestamp)
    if (!point) return false
    return point.msgPerSec > SPIKE_MULTIPLIER * rollingAverage30s
  },
}))
