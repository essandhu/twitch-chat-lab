import { useHeatmapData } from '../../hooks/useHeatmapData'
import { EngagementChart } from './EngagementChart'
import { StatCard } from './StatCard'

export const HeatmapPanel = () => {
  const { currentMsgPerSec, peakMsgPerSec } = useHeatmapData()
  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-3 p-3">
        <StatCard label="Now" value={currentMsgPerSec.toLocaleString('en-US')} />
        <StatCard
          label="Peak"
          value={peakMsgPerSec.toLocaleString('en-US')}
          accent="peak"
        />
      </div>
      <div className="flex-1 min-h-0 p-3">
        <EngagementChart />
      </div>
    </div>
  )
}
