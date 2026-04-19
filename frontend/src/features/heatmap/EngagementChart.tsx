import { Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useHeatmapData } from '../../hooks/useHeatmapData'
import { tokenRgb, tokenRgba, type Token } from '../../lib/theme'
import type { EventAnnotation, HeatmapDataPoint } from '../../types/twitch'

export const formatTickMMSS = (startMs: number, ts: number): string => {
  const totalSec = Math.max(0, Math.floor((ts - startMs) / 1000))
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const ss = (totalSec % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

// Recharts wants SVG stroke strings, not Tailwind classes. We drive these from
// our CSS variable tokens so the chart re-tints automatically in light mode.
const MULTI_PALETTE_TOKENS: Token[] = ['accent', 'success', 'warning']
const MULTI_PALETTE: string[] = MULTI_PALETTE_TOKENS.map((t) => tokenRgb(t))

const annotationColor = (type: EventAnnotation['type']): string => {
  switch (type) {
    case 'raid':
      return tokenRgb('warning')
    case 'subscription':
    case 'gift_sub':
      return tokenRgb('accent')
    case 'hype_train_begin':
    case 'hype_train_end':
      return tokenRgb('danger')
    default:
      return tokenRgb('textMuted')
  }
}

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
        <p className="font-mono text-sm text-text-muted">Waiting for chat…</p>
      </div>
    )
  }

  const startMs = dataPoints[0].timestamp
  const formatTick = (ts: number): string =>
    dataPoints.length === 0 ? '' : formatTickMMSS(startMs, ts)

  const axisStroke = tokenRgba('textMuted', 0.3)
  const mainStroke = tokenRgb('accent')

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
          stroke={axisStroke}
        />
        <YAxis domain={[0, 'auto']} allowDecimals={false} stroke={axisStroke} />
        <Line
          type="monotone"
          dataKey="msgPerSec"
          stroke={mainStroke}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {annotations.map((a) => {
          const color = annotationColor(a.type)
          return (
            <ReferenceLine
              key={`${a.timestamp}-${a.type}`}
              x={a.timestamp}
              stroke={color}
              strokeDasharray="3 3"
              label={{
                value: a.label,
                fill: color,
                fontSize: 10,
                position: 'top',
                style: { backgroundColor: tokenRgba('warning', 0.4) },
              }}
            />
          )
        })}
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
        <p className="font-mono text-sm text-text-muted">Waiting for chat…</p>
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

  const axisStroke = tokenRgba('textMuted', 0.3)
  const legendColor = tokenRgb('textMuted')

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
          stroke={axisStroke}
          allowDuplicatedCategory={false}
        />
        <YAxis domain={[0, 'auto']} allowDecimals={false} stroke={axisStroke} />
        <Legend wrapperStyle={{ color: legendColor }} />
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
        {annotationEntries.map((a) => {
          const color = annotationColor(a.type)
          return (
            <ReferenceLine
              key={a.key}
              x={a.timestamp}
              stroke={color}
              strokeDasharray="3 3"
              label={{ value: a.label, fill: color, fontSize: 10, position: 'top' }}
            />
          )
        })}
      </LineChart>
    </ResponsiveContainer>
  )
}
