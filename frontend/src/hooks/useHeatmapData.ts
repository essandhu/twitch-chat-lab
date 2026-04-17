import { useHeatmapStore } from '../store/heatmapStore'

export const useHeatmapData = () => {
  const dataPoints = useHeatmapStore((s) => s.dataPoints)
  const annotations = useHeatmapStore((s) => s.annotations)
  const currentMsgPerSec = useHeatmapStore((s) => s.currentMsgPerSec)
  const peakMsgPerSec = useHeatmapStore((s) => s.peakMsgPerSec)
  return { dataPoints, annotations, currentMsgPerSec, peakMsgPerSec }
}
