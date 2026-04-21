import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover'
import { Tooltip } from '../../components/ui/Tooltip'
import { tokenRgb, tokenRgba } from '../../lib/theme'
import { useSliceFor } from '../../store/intelligenceStore'
import type { AnomalySignals } from '../../types/twitch'
import { bandLabel, styleFor } from './raidRiskChipColors'

interface RaidRiskChipProps {
  streamLogin?: string
  compact?: boolean
}

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

const formatSignal = (n: number): string => n.toFixed(2)

export function RaidRiskChip({ streamLogin, compact = false }: RaidRiskChipProps): JSX.Element {
  const slice = useSliceFor(streamLogin)
  const band = slice?.raidBand ?? 'calm'
  const score = slice?.raidRiskScore ?? 0
  const signals: AnomalySignals = slice?.anomalySignals ?? {
    similarityBurst: 0,
    lexicalDiversityDrop: 0,
    emoteVsTextRatio: 0,
    newChatterInflux: 0,
  }
  const history = slice?.signalHistory ?? []
  const style = styleFor(band)
  const stroke = tokenRgb(style.dotToken)
  const [open, setOpen] = useState(false)

  const tooltipContent = (
    <span className="font-mono text-[11px] uppercase tracking-[0.2em]">Raid risk: {bandLabel(band)}</span>
  )

  const ScoreRow = ({ label, value }: { label: string; value: number }) => (
    <div className="flex items-baseline justify-between gap-4 font-mono text-[11px] tabular-nums">
      <span className="text-text-muted">{label}</span>
      <span>{formatSignal(value)}</span>
    </div>
  )

  const series = useMemo(
    () => ({
      similarityBurst: history.map((h) => h.similarityBurst),
      lexicalDiversityDrop: history.map((h) => h.lexicalDiversityDrop),
      emoteVsTextRatio: history.map((h) => h.emoteVsTextRatio),
      newChatterInflux: history.map((h) => h.newChatterInflux),
    }),
    [history],
  )

  const dotSize = compact ? 'h-1.5 w-1.5' : 'h-2 w-2'
  const textSize = compact ? 'text-[9px]' : 'text-[10px]'
  const padding = compact ? 'px-1.5 py-0.5' : 'px-2 py-1'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={tooltipContent} side="bottom">
        <PopoverTrigger asChild>
          <button
            type="button"
            role="button"
            aria-label={`Raid risk: ${band}`}
            aria-haspopup="dialog"
            data-testid="raid-risk-chip"
            data-band={band}
            className={`inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface/50 font-mono ${textSize} ${padding} uppercase tracking-[0.2em] text-text transition hover:border-border hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent`}
            style={{ borderColor: tokenRgba(style.dotToken, 0.35) }}
          >
            <span
              className={`relative inline-block ${dotSize}`}
              aria-hidden="true"
            >
              {style.pulse && (
                <span
                  className="absolute inset-0 animate-ping rounded-full"
                  style={{ backgroundColor: tokenRgba(style.dotToken, 0.6) }}
                />
              )}
              <span
                className="absolute inset-0 rounded-full"
                style={{ backgroundColor: stroke }}
              />
            </span>
            <span className="text-text">{bandLabel(band)}</span>
            <span className="tabular-nums text-text-muted">{score}</span>
          </button>
        </PopoverTrigger>
      </Tooltip>
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
    </Popover>
  )
}
