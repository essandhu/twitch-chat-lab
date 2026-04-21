import { useState } from 'react'
import { Popover, PopoverTrigger } from '../../components/ui/Popover'
import { Tooltip } from '../../components/ui/Tooltip'
import { tokenRgb, tokenRgba } from '../../lib/theme'
import { useSliceFor } from '../../store/intelligenceStore'
import type { AnomalySignals } from '../../types/twitch'
import { bandLabel, styleFor } from './raidRiskChipColors'
import { RaidRiskChipPopover } from './RaidRiskChipPopover'

interface RaidRiskChipProps {
  streamLogin?: string
  compact?: boolean
}

const EMPTY_SIGNALS: AnomalySignals = {
  similarityBurst: 0,
  lexicalDiversityDrop: 0,
  emoteVsTextRatio: 0,
  newChatterInflux: 0,
}

export function RaidRiskChip({ streamLogin, compact = false }: RaidRiskChipProps): JSX.Element {
  const slice = useSliceFor(streamLogin)
  const band = slice?.raidBand ?? 'calm'
  const score = slice?.raidRiskScore ?? 0
  const signals: AnomalySignals = slice?.anomalySignals ?? EMPTY_SIGNALS
  const history = slice?.signalHistory ?? []
  const style = styleFor(band)
  const stroke = tokenRgb(style.dotToken)
  const [open, setOpen] = useState(false)

  const tooltipContent = (
    <span className="font-mono text-[11px] uppercase tracking-[0.2em]">Raid risk: {bandLabel(band)}</span>
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
            <span className={`relative inline-block ${dotSize}`} aria-hidden="true">
              {style.pulse && (
                <span
                  className="absolute inset-0 animate-ping rounded-full"
                  style={{ backgroundColor: tokenRgba(style.dotToken, 0.6) }}
                />
              )}
              <span className="absolute inset-0 rounded-full" style={{ backgroundColor: stroke }} />
            </span>
            <span className="text-text">{bandLabel(band)}</span>
            <span className="tabular-nums text-text-muted">{score}</span>
          </button>
        </PopoverTrigger>
      </Tooltip>
      <RaidRiskChipPopover band={band} score={score} signals={signals} history={history} stroke={stroke} />
    </Popover>
  )
}
