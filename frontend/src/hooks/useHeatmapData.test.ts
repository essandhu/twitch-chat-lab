import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useHeatmapStore } from '../store/heatmapStore'
import { useHeatmapData } from './useHeatmapData'

describe('useHeatmapData', () => {
  beforeEach(() => {
    useHeatmapStore.getState().reset()
  })

  it('returns store slices keyed as {dataPoints, annotations, currentMsgPerSec, peakMsgPerSec}', () => {
    const { result } = renderHook(() => useHeatmapData())
    expect(result.current).toEqual({
      dataPoints: [],
      annotations: [],
      currentMsgPerSec: 0,
      peakMsgPerSec: 0,
    })
  })

  it('rerenders when individual slices change', () => {
    const { result } = renderHook(() => useHeatmapData())

    act(() => {
      useHeatmapStore.setState({
        dataPoints: [{ timestamp: 1000, msgPerSec: 5 }],
      })
    })
    expect(result.current.dataPoints).toEqual([{ timestamp: 1000, msgPerSec: 5 }])

    act(() => {
      useHeatmapStore.setState({
        annotations: [{ timestamp: 2000, type: 'raid', label: 'Raid!' }],
      })
    })
    expect(result.current.annotations).toHaveLength(1)

    act(() => {
      useHeatmapStore.setState({ currentMsgPerSec: 12 })
    })
    expect(result.current.currentMsgPerSec).toBe(12)

    act(() => {
      useHeatmapStore.setState({ peakMsgPerSec: 42 })
    })
    expect(result.current.peakMsgPerSec).toBe(42)
  })
})
