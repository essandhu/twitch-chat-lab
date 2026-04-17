import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useHeatmapStore } from '../store/heatmapStore'
import { useMultiStreamStore } from '../store/multiStreamStore'
import { useHeatmapData } from './useHeatmapData'

describe('useHeatmapData', () => {
  beforeEach(() => {
    useHeatmapStore.getState().reset()
    useMultiStreamStore.getState().reset()
  })

  it('returns single-mode slices when multiStreamStore is inactive', () => {
    const { result } = renderHook(() => useHeatmapData())
    expect(result.current).toEqual({
      mode: 'single',
      dataPoints: [],
      annotations: [],
      currentMsgPerSec: 0,
      peakMsgPerSec: 0,
    })
  })

  it('rerenders when individual single-mode slices change', () => {
    const { result } = renderHook(() => useHeatmapData())

    act(() => {
      useHeatmapStore.setState({
        dataPoints: [{ timestamp: 1000, msgPerSec: 5 }],
      })
    })
    if (result.current.mode !== 'single') throw new Error('expected single mode')
    expect(result.current.dataPoints).toEqual([{ timestamp: 1000, msgPerSec: 5 }])

    act(() => {
      useHeatmapStore.setState({
        annotations: [{ timestamp: 2000, type: 'raid', label: 'Raid!' }],
      })
    })
    if (result.current.mode !== 'single') throw new Error('expected single mode')
    expect(result.current.annotations).toHaveLength(1)

    act(() => {
      useHeatmapStore.setState({ currentMsgPerSec: 12 })
    })
    if (result.current.mode !== 'single') throw new Error('expected single mode')
    expect(result.current.currentMsgPerSec).toBe(12)

    act(() => {
      useHeatmapStore.setState({ peakMsgPerSec: 42 })
    })
    if (result.current.mode !== 'single') throw new Error('expected single mode')
    expect(result.current.peakMsgPerSec).toBe(42)
  })
})
