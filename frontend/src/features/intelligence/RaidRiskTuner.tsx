import { useMemo, useState } from 'react'
import { useIntelligenceStore } from '../../store/intelligenceStore'
import { DEFAULT_WEIGHTS, type Weights } from './raidRiskScore'

const isTuneEnabled = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('tune') === '1'
  } catch {
    return false
  }
}

const renormalize = (w: Weights): Weights => {
  const total =
    w.similarityBurst + w.newChatterInflux + w.lexicalDiversityDrop + w.emoteVsTextRatio
  if (total === 0) return { ...DEFAULT_WEIGHTS }
  return {
    similarityBurst: w.similarityBurst / total,
    newChatterInflux: w.newChatterInflux / total,
    lexicalDiversityDrop: w.lexicalDiversityDrop / total,
    emoteVsTextRatio: w.emoteVsTextRatio / total,
  }
}

type Row = { key: keyof Weights; label: string }
const ROWS: Row[] = [
  { key: 'similarityBurst', label: 'similarity' },
  { key: 'newChatterInflux', label: 'new chatter' },
  { key: 'lexicalDiversityDrop', label: 'diversity drop' },
  { key: 'emoteVsTextRatio', label: 'emote ratio' },
]

export function RaidRiskTuner(): JSX.Element | null {
  const enabled = useMemo(isTuneEnabled, [])
  const setOverride = useIntelligenceStore((s) => s.setWeightsOverride)
  const [raw, setRaw] = useState<Weights>({ ...DEFAULT_WEIGHTS })

  if (!enabled) return null

  const handleChange = (key: keyof Weights, value: number) => {
    const nextRaw = { ...raw, [key]: value }
    setRaw(nextRaw)
    setOverride(renormalize(nextRaw))
  }

  const normalized = renormalize(raw)

  return (
    <div
      data-testid="raid-risk-tuner"
      className="flex flex-col gap-1 rounded border border-border bg-surface-raised/50 p-2 font-mono text-[11px]"
    >
      <div className="flex items-baseline justify-between">
        <span className="uppercase tracking-[0.22em] text-text-muted">risk weights</span>
        <span className="tabular-nums text-text-muted">?tune=1</span>
      </div>
      {ROWS.map((row) => {
        const v = raw[row.key]
        const pct = Math.round(normalized[row.key] * 100)
        return (
          <label key={row.key} className="flex items-center gap-2">
            <span className="w-28 text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {row.label}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={v}
              onChange={(e) => handleChange(row.key, Number(e.target.value))}
              className="flex-1 accent-[rgb(var(--accent))]"
              aria-label={`${row.label} weight`}
            />
            <span className="w-10 text-right tabular-nums">{pct}%</span>
          </label>
        )
      })}
    </div>
  )
}
