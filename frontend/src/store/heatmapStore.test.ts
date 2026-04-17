import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventAnnotation } from '../types/twitch'
import { useHeatmapStore } from './heatmapStore'

const base = new Date('2025-01-01T00:00:00Z').getTime()

describe('heatmapStore', () => {
  beforeEach(() => {
    useHeatmapStore.getState().reset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(base))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tick() snapshots the counter, resets it, and appends a HeatmapDataPoint', () => {
    const s = useHeatmapStore.getState()
    s.incrementCounter()
    s.incrementCounter()
    s.incrementCounter()
    s.tick()

    const { dataPoints, currentMsgPerSec } = useHeatmapStore.getState()
    expect(dataPoints).toHaveLength(1)
    expect(dataPoints[0]?.msgPerSec).toBe(3)
    expect(currentMsgPerSec).toBe(3)

    vi.setSystemTime(new Date(base + 1000))
    useHeatmapStore.getState().tick()
    const after = useHeatmapStore.getState()
    expect(after.dataPoints).toHaveLength(2)
    expect(after.dataPoints[1]?.msgPerSec).toBe(0)
    expect(after.currentMsgPerSec).toBe(0)
  })

  it('caps dataPoints at 300 (rolling 5-minute window)', () => {
    const s = useHeatmapStore.getState()
    for (let i = 0; i < 301; i += 1) {
      vi.setSystemTime(new Date(base + i * 1000))
      s.incrementCounter()
      s.tick()
    }
    const { dataPoints } = useHeatmapStore.getState()
    expect(dataPoints).toHaveLength(300)
    expect(dataPoints[0]?.timestamp).toBe(base + 1000)
    expect(dataPoints[299]?.timestamp).toBe(base + 300_000)
  })

  it('tracks peakMsgPerSec across ticks', () => {
    const s = useHeatmapStore.getState()
    const counts = [1, 5, 3, 9, 2]
    counts.forEach((n, i) => {
      for (let j = 0; j < n; j += 1) s.incrementCounter()
      vi.setSystemTime(new Date(base + i * 1000))
      s.tick()
    })
    expect(useHeatmapStore.getState().peakMsgPerSec).toBe(9)
  })

  it('computes rollingAverage30s as the mean of the last 30 points', () => {
    const s = useHeatmapStore.getState()
    for (let i = 0; i < 30; i += 1) {
      for (let j = 0; j < 10; j += 1) s.incrementCounter()
      vi.setSystemTime(new Date(base + i * 1000))
      s.tick()
    }
    expect(useHeatmapStore.getState().rollingAverage30s).toBeCloseTo(10, 5)
  })

  it('computes rollingAverage30s over fewer points when under 30 exist', () => {
    const s = useHeatmapStore.getState()
    const counts = [2, 4]
    counts.forEach((n, i) => {
      for (let j = 0; j < n; j += 1) s.incrementCounter()
      vi.setSystemTime(new Date(base + i * 1000))
      s.tick()
    })
    expect(useHeatmapStore.getState().rollingAverage30s).toBeCloseTo(3, 5)
  })

  it('isDuringSpike returns true when the closest-preceding point exceeds 2 × rollingAverage30s', () => {
    const s = useHeatmapStore.getState()
    for (let i = 0; i < 30; i += 1) {
      for (let j = 0; j < 10; j += 1) s.incrementCounter()
      vi.setSystemTime(new Date(base + i * 1000))
      s.tick()
    }
    for (let j = 0; j < 25; j += 1) s.incrementCounter()
    vi.setSystemTime(new Date(base + 30_000))
    s.tick()

    expect(useHeatmapStore.getState().isDuringSpike(base + 30_500)).toBe(true)
    expect(useHeatmapStore.getState().isDuringSpike(base + 5_000)).toBe(false)
  })

  it('isDuringSpike returns false when there are no data points', () => {
    expect(useHeatmapStore.getState().isDuringSpike(Date.now())).toBe(false)
  })

  it('addAnnotation appends entries in order', () => {
    const s = useHeatmapStore.getState()
    const a: EventAnnotation = { timestamp: 1, type: 'raid', label: 'Raid from A' }
    const b: EventAnnotation = { timestamp: 2, type: 'subscription', label: 'Sub from B' }
    s.addAnnotation(a)
    s.addAnnotation(b)
    expect(useHeatmapStore.getState().annotations).toEqual([a, b])
  })

  it('reset() clears all state', () => {
    const s = useHeatmapStore.getState()
    s.incrementCounter()
    s.tick()
    s.addAnnotation({ timestamp: 1, type: 'raid', label: 'x' })
    s.reset()
    const state = useHeatmapStore.getState()
    expect(state.dataPoints).toHaveLength(0)
    expect(state.annotations).toHaveLength(0)
    expect(state.currentMsgPerSec).toBe(0)
    expect(state.peakMsgPerSec).toBe(0)
    expect(state.rollingAverage30s).toBe(0)
  })
})
