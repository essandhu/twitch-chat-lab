import { useHeatmapData } from '../../hooks/useHeatmapData'
import { CorrelationPanel } from './CorrelationPanel'
import { EngagementChart } from './EngagementChart'
import { StatCard } from './StatCard'
import { MomentsTimeline } from '../semantic/MomentsTimeline'

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

  const isMulti = data.mode === 'multi'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="grid shrink-0 grid-cols-2 gap-3 p-3">
        <StatCard label="Now (msg/s)" value={currentValue.toLocaleString('en-US')} />
        <StatCard
          label="Peak (msg/s)"
          value={peakValue.toLocaleString('en-US')}
          accent="peak"
        />
      </div>
      <div className="shrink-0">
        <MomentsTimeline />
      </div>
      <div
        className={
          isMulti
            ? 'h-[360px] shrink-0 p-3'
            : 'min-h-[320px] flex-1 p-3'
        }
      >
        <EngagementChart />
      </div>
      {isMulti && (
        <div className="h-[260px] shrink-0 border-t border-border p-3">
          <CorrelationPanel />
        </div>
      )}
    </div>
  )
}
