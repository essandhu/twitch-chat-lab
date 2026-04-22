import { useEffect, useRef } from 'react'
import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { pairKeyFor, useMultiStreamStore } from '../../store/multiStreamStore'
import { tokenRgb, tokenRgba, type Token } from '../../lib/theme'

const BUFFER_CAP = 60
const PALETTE: Token[] = ['accent', 'success', 'warning', 'danger']

export const AXIS_LABEL_TIME = 'Time (mm:ss)'
export const AXIS_LABEL_CORRELATION = 'Correlation (r)'

interface Snapshot {
  t: number
  r: number
  lagMs: number
}

type PairBuffers = Map<string, Snapshot[]>

const formatClock = (startMs: number, ts: number): string => {
  const total = Math.max(0, Math.floor((ts - startMs) / 1000))
  const mm = Math.floor(total / 60).toString().padStart(2, '0')
  const ss = (total % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

interface TooltipPayloadEntry {
  value?: number
  name?: string
  color?: string
  stroke?: string
  payload?: Snapshot
}

interface CorrelationTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: number
  startMs: number
}

export const CorrelationTooltip = ({
  active,
  payload,
  label,
  startMs,
}: CorrelationTooltipProps) => {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null
  }
  const time = formatClock(startMs, label)
  return (
    <div
      className="rounded border border-border bg-surface-raised px-2 py-1.5 font-mono text-[11px] shadow-lg"
      role="tooltip"
    >
      <div className="text-text-muted">{time}</div>
      {payload.map((entry, idx) => {
        const swatch = entry.color ?? entry.stroke ?? tokenRgb('accent')
        const r = typeof entry.value === 'number' ? entry.value : Number.NaN
        const lagMs = entry.payload?.lagMs ?? 0
        return (
          <div key={idx} className="mt-0.5 flex items-center gap-1.5 text-text">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: swatch }}
            />
            {entry.name ? <span className="text-text-muted">{entry.name}:</span> : null}
            <span>r={Number.isNaN(r) ? 'n/a' : r.toFixed(2)}, lag={lagMs}ms</span>
          </div>
        )
      })}
    </div>
  )
}

export function CorrelationPanel(): JSX.Element | null {
  const isActive = useMultiStreamStore((s) => s.isActive)
  const order = useMultiStreamStore((s) => s.order)
  const correlation = useMultiStreamStore((s) => s.correlation)
  const buffersRef = useRef<PairBuffers>(new Map())
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (startRef.current === null) startRef.current = Date.now()
    for (const [key, entry] of Object.entries(correlation)) {
      const list = buffersRef.current.get(key) ?? []
      const last = list[list.length - 1]
      if (!last || last.t !== entry.updatedAt) {
        list.push({ t: entry.updatedAt, r: entry.coefficient, lagMs: entry.lagMs })
        if (list.length > BUFFER_CAP) list.splice(0, list.length - BUFFER_CAP)
        buffersRef.current.set(key, list)
      }
    }
  }, [correlation])

  if (!isActive || order.length < 2) return null

  const pairs: { key: string; a: string; b: string }[] = []
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      pairs.push({ key: pairKeyFor(order[i], order[j]), a: order[i], b: order[j] })
    }
  }

  const start = startRef.current ?? Date.now()
  const axisStroke = tokenRgba('textMuted', 0.3)
  const axisLabelFill = tokenRgb('textMuted')
  const legendColor = tokenRgb('textMuted')

  return (
    <div
      data-testid="correlation-chart"
      className="h-full w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 32, right: 16, bottom: 28, left: 16 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ts: number) => formatClock(start, ts)}
            tickCount={5}
            interval="preserveStartEnd"
            stroke={axisStroke}
            allowDuplicatedCategory={false}
            label={{
              value: AXIS_LABEL_TIME,
              position: 'insideBottom',
              offset: -12,
              fill: axisLabelFill,
              fontSize: 10,
            }}
          />
          <YAxis
            domain={[-1, 1]}
            stroke={axisStroke}
            allowDecimals
            label={{
              value: AXIS_LABEL_CORRELATION,
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
              <CorrelationTooltip
                {...(props as CorrelationTooltipProps)}
                startMs={start}
              />
            )}
          />
          <Legend
            verticalAlign="top"
            align="center"
            height={24}
            wrapperStyle={{ color: legendColor, paddingBottom: 4 }}
          />
          {pairs.map((pair, idx) => {
            const buffer = buffersRef.current.get(pair.key) ?? []
            return (
              <Line
                key={pair.key}
                type="monotone"
                data={buffer}
                dataKey="r"
                name={pair.key}
                stroke={tokenRgb(PALETTE[idx % PALETTE.length])}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
