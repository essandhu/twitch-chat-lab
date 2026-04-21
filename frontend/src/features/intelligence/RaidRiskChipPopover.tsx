import { useMemo } from 'react'
import { PopoverContent } from '../../components/ui/Popover'
import type { RiskBand } from '../filters/filterQueryTokens'
import type { AnomalySignals } from '../../types/twitch'
import { bandLabel } from './raidRiskChipColors'

type SignalHistoryPoint = { t: number } & AnomalySignals

const SPARK_W = 120
const SPARK_H = 24

const sparklinePath = (values: number[]): string => {
  if (values.length === 0) return ''
  if (values.length === 1) return `M0,${SPARK_H / 2} L${SPARK_W},${SPARK_H / 2}`
  const step = SPARK_W / (values.length - 1)
  return values
    .map((v, i) => {
      const x = i * step
      const y = SPARK_H - Math.max(0, Math.min(1, v)) * SPARK_H
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

const Sparkline = ({ label, values, stroke }: { label: string; values: number[]; stroke: string }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</span>
    <svg width={SPARK_W} height={SPARK_H} aria-hidden="true" className="shrink-0">
      <path d={sparklinePath(values)} fill="none" stroke={stroke} strokeWidth={1.4} />
    </svg>
  </div>
)

const ScoreRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-baseline justify-between gap-4 font-mono text-[11px] tabular-nums">
    <span className="text-text-muted">{label}</span>
    <span>{value.toFixed(2)}</span>
  </div>
)

interface RaidRiskChipPopoverProps {
  band: RiskBand
  score: number
  signals: AnomalySignals
  history: SignalHistoryPoint[]
  stroke: string
}

export function RaidRiskChipPopover({
  band,
  score,
  signals,
  history,
  stroke,
}: RaidRiskChipPopoverProps): JSX.Element {
  const series = useMemo(
    () => ({
      similarityBurst: history.map((h) => h.similarityBurst),
      lexicalDiversityDrop: history.map((h) => h.lexicalDiversityDrop),
      emoteVsTextRatio: history.map((h) => h.emoteVsTextRatio),
      newChatterInflux: history.map((h) => h.newChatterInflux),
    }),
    [history],
  )

  return (
    <PopoverContent
      role="dialog"
      aria-label="Raid risk signal history"
      className="min-w-[260px] space-y-1.5"
      data-testid="raid-risk-popover"
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
          60 s signal history
        </span>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: stroke }}>
          {bandLabel(band)} · {score}
        </span>
      </div>
      <div className="space-y-0.5 border-b border-border/50 pb-2">
        <ScoreRow label="similarityBurst" value={signals.similarityBurst} />
        <ScoreRow label="lexicalDiversityDrop" value={signals.lexicalDiversityDrop} />
        <ScoreRow label="emoteVsTextRatio" value={signals.emoteVsTextRatio} />
        <ScoreRow label="newChatterInflux" value={signals.newChatterInflux} />
      </div>
      <Sparkline label="similarityBurst" values={series.similarityBurst} stroke={stroke} />
      <Sparkline label="lexicalDiversityDrop" values={series.lexicalDiversityDrop} stroke={stroke} />
      <Sparkline label="emoteVsTextRatio" values={series.emoteVsTextRatio} stroke={stroke} />
      <Sparkline label="newChatterInflux" values={series.newChatterInflux} stroke={stroke} />
    </PopoverContent>
  )
}
