import { useHeatmapData } from '../../hooks/useHeatmapData'
import { EngagementChart } from './EngagementChart'
import { StatCard } from './StatCard'

export const HeatmapPanel = () => {
  const data = useHeatmapData()

  let currentValue: number
  let peakValue: number

  if (data.mode === 'multi') {
    const currents = Object.values(data.currentMsgPerSec)
    const peaks = Object.values(data.peakMsgPerSec)
    currentValue = currents.reduce((sum, v) => sum + v, 0)
    peakValue = peaks.length === 0 ? 0 : Math.max(...peaks)
  } else {
    currentValue = data.currentMsgPerSec
    peakValue = data.peakMsgPerSec
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-3 p-3">
        <StatCard label="Now" value={currentValue.toLocaleString('en-US')} />
        <StatCard
          label="Peak"
          value={peakValue.toLocaleString('en-US')}
          accent="peak"
        />
      </div>
      <div className="flex-1 min-h-0 p-3">
        <EngagementChart />
      </div>
    </div>
  )
}
