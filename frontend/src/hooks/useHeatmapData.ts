import { useHeatmapStore } from '../store/heatmapStore'
import { useMultiStreamStore } from '../store/multiStreamStore'
import type { EventAnnotation, HeatmapDataPoint } from '../types/twitch'

export interface SingleHeatmapData {
  mode: 'single'
  dataPoints: HeatmapDataPoint[]
  annotations: EventAnnotation[]
  currentMsgPerSec: number
  peakMsgPerSec: number
}

export interface MultiHeatmapStream {
  login: string
  displayName: string
  dataPoints: HeatmapDataPoint[]
  annotations: EventAnnotation[]
}

export interface MultiHeatmapData {
  mode: 'multi'
  streams: MultiHeatmapStream[]
  currentMsgPerSec: Record<string, number>
  peakMsgPerSec: Record<string, number>
}

export type UseHeatmapDataResult = SingleHeatmapData | MultiHeatmapData

export const useHeatmapData = (): UseHeatmapDataResult => {
  const isActive = useMultiStreamStore((s) => s.isActive)
  const streamsMap = useMultiStreamStore((s) => s.streams)
  const order = useMultiStreamStore((s) => s.order)

  const singleDataPoints = useHeatmapStore((s) => s.dataPoints)
  const singleAnnotations = useHeatmapStore((s) => s.annotations)
  const singleCurrent = useHeatmapStore((s) => s.currentMsgPerSec)
  const singlePeak = useHeatmapStore((s) => s.peakMsgPerSec)

  if (isActive) {
    const streams: MultiHeatmapStream[] = []
    const currentMsgPerSec: Record<string, number> = {}
    const peakMsgPerSec: Record<string, number> = {}
    for (const login of order) {
      const slice = streamsMap[login]
      if (!slice) continue
      streams.push({
        login: slice.login,
        displayName: slice.displayName,
        dataPoints: slice.dataPoints,
        annotations: slice.annotations,
      })
      currentMsgPerSec[slice.login] = slice.currentMsgPerSec
      peakMsgPerSec[slice.login] = slice.peakMsgPerSec
    }
    return {
      mode: 'multi',
      streams,
      currentMsgPerSec,
      peakMsgPerSec,
    }
  }

  return {
    mode: 'single',
    dataPoints: singleDataPoints,
    annotations: singleAnnotations,
    currentMsgPerSec: singleCurrent,
    peakMsgPerSec: singlePeak,
  }
}
