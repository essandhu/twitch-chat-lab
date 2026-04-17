import { Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useHeatmapData } from '../../hooks/useHeatmapData'
import type { EventAnnotation, HeatmapDataPoint } from '../../types/twitch'

export const formatTickMMSS = (startMs: number, ts: number): string => {
  const totalSec = Math.max(0, Math.floor((ts - startMs) / 1000))
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const ss = (totalSec % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

// ember-500, cobalt-400, sage-400 — used in multi mode via direct stroke={hex}
// since Tailwind utility classes don't reach SVG stroke attributes.
const MULTI_PALETTE = ['#f5a524', '#58a6ff', '#7ee0a6']

interface MultiStreamSeries {
  login: string
  displayName: string
  dataPoints: HeatmapDataPoint[]
  annotations: EventAnnotation[]
}

export const EngagementChart = () => {
  const data = useHeatmapData()

  if (data.mode === 'multi') {
    return <MultiChart streams={data.streams} />
  }

  const { dataPoints, annotations } = data

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

interface MultiChartProps {
  streams: MultiStreamSeries[]
}

const MultiChart = ({ streams }: MultiChartProps) => {
  const activeStreams = streams.filter((s) => s.dataPoints.length > 0)

  if (activeStreams.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="font-mono text-sm text-ink-500">Waiting for chat…</p>
      </div>
    )
  }

  const startMs = activeStreams
    .map((s) => s.dataPoints[0]!.timestamp)
    .reduce((min, ts) => Math.min(min, ts), activeStreams[0]!.dataPoints[0]!.timestamp)

  const formatTick = (ts: number): string => formatTickMMSS(startMs, ts)

  const annotationEntries = streams.flatMap((s) =>
    s.annotations.map((a) => ({
      key: `${s.login}-${a.timestamp}-${a.type}`,
      timestamp: a.timestamp,
      type: a.type,
      label: `${s.displayName} \u00b7 ${a.label}`,
    })),
  )

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTick}
          tickCount={5}
          interval="preserveStartEnd"
          stroke="#a3a3ad"
          allowDuplicatedCategory={false}
        />
        <YAxis domain={[0, 'auto']} allowDecimals={false} stroke="#a3a3ad" />
        <Legend wrapperStyle={{ color: '#a3a3ad' }} />
        {streams.map((s, idx) => (
          <Line
            key={s.login}
            type="monotone"
            data={s.dataPoints}
            dataKey="msgPerSec"
            name={s.displayName}
            stroke={MULTI_PALETTE[idx % MULTI_PALETTE.length]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        {annotationEntries.map((a) => (
          <ReferenceLine
            key={a.key}
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
