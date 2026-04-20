import type { HeatmapDataPoint } from '../../types/twitch'

const WINDOW_SAMPLES = 30
const SPIKE_MULTIPLIER = 2

const rollingAverage = (dataPoints: HeatmapDataPoint[]): number => {
  if (dataPoints.length === 0) return 0
  const window = dataPoints.slice(-WINDOW_SAMPLES)
  let sum = 0
  for (const p of window) sum += p.msgPerSec
  return sum / window.length
}

export const isDuringSpikeFor = (dataPoints: HeatmapDataPoint[]): ((ts: number) => boolean) => {
  const avg = rollingAverage(dataPoints)
  return (ts) => {
    if (dataPoints.length === 0) return false
    let closest: HeatmapDataPoint | null = null
    for (const p of dataPoints) {
      if (p.timestamp <= ts) {
        if (!closest || p.timestamp > closest.timestamp) closest = p
      }
    }
    if (!closest) return false
    return closest.msgPerSec > SPIKE_MULTIPLIER * avg && avg > 0
  }
}
