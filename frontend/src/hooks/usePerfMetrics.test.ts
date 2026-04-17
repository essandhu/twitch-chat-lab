import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetForTests as resetLatencyChannel } from '../services/EventSubLatencyChannel'
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
  })

  it('does nothing when active=false (no interval, no store updates)', () => {
    const before = { ...usePerfStore.getState().metrics }
    renderHook(() => usePerfMetrics(false))

    vi.advanceTimersByTime(2000)

    expect(usePerfStore.getState().metrics).toEqual(before)
  })

  it('writes metrics to the perfStore on each 500 ms tick when active=true', () => {
    // Sanity: start from pristine initial state.
    expect(usePerfStore.getState().metrics.domNodeCount).toBe(0)

    // Inject some DOM nodes so querySelectorAll('*') > 0 after the first tick.
    const scratch = document.createElement('div')
    scratch.appendChild(document.createElement('span'))
    scratch.appendChild(document.createElement('span'))
    document.body.appendChild(scratch)

    renderHook(() => usePerfMetrics(true))

    vi.advanceTimersByTime(500)

    expect(usePerfStore.getState().metrics.domNodeCount).toBeGreaterThan(0)

    document.body.removeChild(scratch)
  })
})
