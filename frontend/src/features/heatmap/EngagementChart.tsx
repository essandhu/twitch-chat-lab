import {
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useHeatmapData } from '../../hooks/useHeatmapData'
import { tokenRgb, tokenRgba, type Token } from '../../lib/theme'
import type { EventAnnotation, HeatmapDataPoint } from '../../types/twitch'
import { AnomalyOverlay } from '../intelligence/AnomalyOverlay'

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

interface TooltipPayloadEntry {
  value?: number
  name?: string
  color?: string
  stroke?: string
}

interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: number
  startMs: number
  showSeriesName: boolean
}

const ChartTooltip = ({
  active,
  payload,
  label,
  startMs,
  showSeriesName,
}: ChartTooltipProps) => {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null
  }
  const time = formatTickMMSS(startMs, label)
  return (
    <div
      className="rounded border border-border bg-surface-raised px-2 py-1.5 font-mono text-[11px] shadow-lg"
      role="tooltip"
    >
      <div className="text-text-muted">{time}</div>
      {payload.map((entry, idx) => {
        const swatch = entry.color ?? entry.stroke ?? tokenRgb('accent')
        const value = typeof entry.value === 'number' ? entry.value : 0
        return (
          <div key={idx} className="mt-0.5 flex items-center gap-1.5 text-text">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: swatch }}
            />
            {showSeriesName && entry.name ? (
              <span className="text-text-muted">{entry.name}:</span>
            ) : null}
            <span>{value.toLocaleString('en-US')} msg/s</span>
          </div>
        )
      })}
    </div>
  )
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
  const axisLabelFill = tokenRgb('textMuted')
  const mainStroke = tokenRgb('accent')

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dataPoints} margin={{ top: 16, right: 16, bottom: 24, left: 16 }}>
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTick}
          tickCount={5}
          interval="preserveStartEnd"
          stroke={axisStroke}
          label={{
            value: 'Time (mm:ss)',
            position: 'insideBottom',
            offset: -8,
            fill: axisLabelFill,
            fontSize: 10,
          }}
        />
        <YAxis
          domain={[0, 'auto']}
          allowDecimals={false}
          stroke={axisStroke}
          label={{
            value: 'Messages / second',
            angle: -90,
            position: 'insideLeft',
            fill: axisLabelFill,
            fontSize: 10,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip
          cursor={{ stroke: axisStroke, strokeDasharray: '3 3' }}
          content={(props) => (
            <ChartTooltip
              {...(props as ChartTooltipProps)}
              startMs={startMs}
              showSeriesName={false}
            />
          )}
        />
        <Line
          type="monotone"
          dataKey="msgPerSec"
          name="Messages / second"
          stroke={mainStroke}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <AnomalyOverlay />
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
  const axisLabelFill = tokenRgb('textMuted')
  const legendColor = tokenRgb('textMuted')

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart margin={{ top: 16, right: 16, bottom: 24, left: 16 }}>
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTick}
          tickCount={5}
          interval="preserveStartEnd"
          stroke={axisStroke}
          allowDuplicatedCategory={false}
          label={{
            value: 'Time (mm:ss)',
            position: 'insideBottom',
            offset: -8,
            fill: axisLabelFill,
            fontSize: 10,
          }}
        />
        <YAxis
          domain={[0, 'auto']}
          allowDecimals={false}
          stroke={axisStroke}
          label={{
            value: 'Messages / second',
            angle: -90,
            position: 'insideLeft',
            fill: axisLabelFill,
            fontSize: 10,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip
          cursor={{ stroke: axisStroke, strokeDasharray: '3 3' }}
          content={(props) => (
            <ChartTooltip
              {...(props as ChartTooltipProps)}
              startMs={startMs}
              showSeriesName={true}
            />
          )}
        />
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
        {streams.map((s, idx) => (
          <AnomalyOverlay
            key={`overlay-${s.login}`}
            streamLogin={s.login}
            label={s.displayName}
            stackOffset={idx}
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
