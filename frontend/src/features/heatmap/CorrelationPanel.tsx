import { useEffect, useRef } from 'react'
import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { pairKeyFor, useMultiStreamStore } from '../../store/multiStreamStore'
import { tokenRgb, tokenRgba, type Token } from '../../lib/theme'

const BUFFER_CAP = 60
const PALETTE: Token[] = ['accent', 'warning', 'success', 'danger']

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
  const legendColor = tokenRgb('textMuted')

  return (
    <div
      data-testid="correlation-chart"
      className="h-full w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ts: number) => formatClock(start, ts)}
            stroke={axisStroke}
            allowDuplicatedCategory={false}
          />
          <YAxis domain={[-1, 1]} stroke={axisStroke} allowDecimals />
          <Legend wrapperStyle={{ color: legendColor }} />
          <Tooltip
            formatter={(value: number, _name, item) => {
              const snapshot = item.payload as Snapshot | undefined
              const key = (item as unknown as { name?: string }).name ?? ''
              const lagMs = snapshot?.lagMs ?? 0
              const coeff = Number.isNaN(value) ? NaN : value
              return [`${key}: r=${coeff.toFixed(2)}, lag=${lagMs}ms`, '']
            }}
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
