import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetForTests as resetLatencyChannel,
  recordLatencySample,
} from '../services/EventSubLatencyChannel'
import { usePerfStore } from '../store/perfStore'
import { usePerfMetrics } from './usePerfMetrics'

describe('usePerfMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    usePerfStore.getState().reset()
    resetLatencyChannel()
  })

  afterEach(() => {
    vi.useRealTimers()
    // Restore performance.memory if stubbed
    delete (performance as any).memory
  })

  it('does nothing when active=false (no interval, no store updates)', () => {
    const before = { ...usePerfStore.getState().metrics }
    renderHook(() => usePerfMetrics(false))

    vi.advanceTimersByTime(2000)

    expect(usePerfStore.getState().metrics).toEqual(before)
  })

  it('writes DOM node count and JS heap to the perfStore on each 500 ms tick when active=true', () => {
    // Sanity: start from pristine initial state.
    expect(usePerfStore.getState().metrics.domNodeCount).toBe(0)

    // Inject some DOM nodes so querySelectorAll('*') > 0 after the first tick.
    const scratch = document.createElement('div')
    scratch.appendChild(document.createElement('span'))
    scratch.appendChild(document.createElement('span'))
    document.body.appendChild(scratch)

    // Stub performance.memory BEFORE the hook ticks.
    ;(performance as any).memory = { usedJSHeapSize: 157 * 1_048_576 }

    renderHook(() => usePerfMetrics(true))

    vi.advanceTimersByTime(500)

    const metrics = usePerfStore.getState().metrics
    expect(metrics.domNodeCount).toBeGreaterThan(0)
    expect(metrics.jsHeapUsedMB).toBeCloseTo(157, 1)

    document.body.removeChild(scratch)
  })

  it('reports jsHeapUsedMB as null when performance.memory is absent', () => {
    // Ensure performance.memory is absent.
    delete (performance as any).memory

    renderHook(() => usePerfMetrics(true))

    vi.advanceTimersByTime(500)

    expect(usePerfStore.getState().metrics.jsHeapUsedMB).toBeNull()
  })

  it('smooths EventSub latency samples via EMA across ticks', () => {
    renderHook(() => usePerfMetrics(true))

    // Tick 1: sample = 1000 - 800 = 200
    recordLatencySample(1000, new Date(800).toISOString())
    vi.advanceTimersByTime(500)

    // Tick 2: sample = 2000 - 1400 = 600
    recordLatencySample(2000, new Date(1400).toISOString())
    vi.advanceTimersByTime(500)

    const ema = usePerfStore.getState().metrics.eventSubLatencyMs

    // Prove smoothing: neither raw sample passes through untouched.
    expect(ema).toBeGreaterThan(40)
    expect(ema).toBeLessThan(600)
    // Expected EMA: 0.2 * 600 + 0.8 * (0.2 * 200 + 0.8 * 0) = 120 + 32 = 152
    expect(ema).toBeCloseTo(152, 0)
  })

  it('cleans up the interval on unmount (no further store writes)', () => {
    // Inject DOM nodes so the first tick produces a non-initial snapshot.
    const scratch = document.createElement('div')
    scratch.appendChild(document.createElement('span'))
    document.body.appendChild(scratch)

    const { unmount } = renderHook(() => usePerfMetrics(true))

    vi.advanceTimersByTime(500)

    // Confirm at least one tick happened: DOM node count reflects the injected nodes.
    const snapshotAtUnmount = { ...usePerfStore.getState().metrics }
    expect(snapshotAtUnmount.domNodeCount).toBeGreaterThan(0)

    unmount()

    // After unmount, add more DOM nodes — if the interval still fires, domNodeCount would change.
    scratch.appendChild(document.createElement('span'))
    scratch.appendChild(document.createElement('span'))
    scratch.appendChild(document.createElement('span'))

    vi.advanceTimersByTime(2000)

    // Snapshot after unmount should be identical — no more ticks fired.
    expect(usePerfStore.getState().metrics).toEqual(snapshotAtUnmount)

    document.body.removeChild(scratch)
  })
})
