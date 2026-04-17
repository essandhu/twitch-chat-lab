import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useHeatmapData } from '../../hooks/useHeatmapData'

export const formatTickMMSS = (startMs: number, ts: number): string => {
  const totalSec = Math.max(0, Math.floor((ts - startMs) / 1000))
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const ss = (totalSec % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export const EngagementChart = () => {
  const { dataPoints, annotations } = useHeatmapData()

  if (dataPoints.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="font-mono text-sm text-ink-500">Waiting for chat…</p>
      </div>
    )
  }

  const startMs = dataPoints[0].timestamp
  const formatTick = (ts: number): string =>
    dataPoints.length === 0 ? '' : formatTickMMSS(startMs, ts)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dataPoints} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTick}
          tickCount={5}
          interval="preserveStartEnd"
          stroke="#a3a3ad"
        />
        <YAxis domain={[0, 'auto']} allowDecimals={false} stroke="#a3a3ad" />
        <Line
          type="monotone"
          dataKey="msgPerSec"
          stroke="#f5a524"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {annotations.map((a) => (
          <ReferenceLine
            key={`${a.timestamp}-${a.type}`}
            x={a.timestamp}
            stroke="#a3a3ad"
            strokeDasharray="3 3"
            label={{ value: a.label, fill: '#a3a3ad', fontSize: 10, position: 'top' }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
