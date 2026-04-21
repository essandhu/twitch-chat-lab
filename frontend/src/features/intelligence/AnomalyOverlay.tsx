import { Fragment } from 'react'
import { ReferenceArea } from 'recharts'
import type { RiskBand } from '../filters/filterQueryTokens'
import { tokenRgb, tokenRgba } from '../../lib/theme'
import type { AnomalySignals } from '../../types/twitch'
import { useIntelligenceStore, PRIMARY_STREAM_KEY } from '../../store/intelligenceStore'
import { bandFor, computeRaidRiskScore } from './raidRiskScore'

interface AnomalyOverlayProps {
  streamLogin?: string
  label?: string
  stackOffset?: number
}

interface Band {
  start: number
  end: number
  band: RiskBand
}

type HistoryEntry = { t: number } & AnomalySignals

export const computeBands = (history: HistoryEntry[]): Band[] => {
  const out: Band[] = []
  let current: Band | null = null
  for (const entry of history) {
    const b = bandFor(computeRaidRiskScore(entry))
    if (b === 'calm') {
      if (current) { out.push(current); current = null }
      continue
    }
    if (!current) { current = { start: entry.t, end: entry.t, band: b }; continue }
    if (current.band === b) { current.end = entry.t; continue }
    out.push(current)
    current = { start: entry.t, end: entry.t, band: b }
  }
  if (current) out.push(current)
  return out
}

const fillFor = (band: RiskBand): string =>
  band === 'critical' ? tokenRgba('danger', 0.15) : tokenRgba('warning', 0.15)

const strokeFor = (band: RiskBand): string =>
  band === 'critical' ? tokenRgb('danger') : tokenRgb('warning')

interface BandShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  band: RiskBand
  label?: string
  stackOffset?: number
}

const BandShape = ({ x = 0, y = 0, width = 0, height = 0, band, label, stackOffset = 0 }: BandShapeProps) => {
  const offsetY = y + stackOffset * 4
  const offsetHeight = Math.max(0, height - stackOffset * 4)
  return (
    <g data-testid="anomaly-overlay" data-band={band}>
      <rect
        x={x}
        y={offsetY}
        width={width}
        height={offsetHeight}
        fill={fillFor(band)}
        stroke={strokeFor(band)}
        strokeWidth={1}
        strokeDasharray="4 2"
      />
      {label ? (
        <text x={x + 4} y={offsetY + 12} fontSize={9} fill={strokeFor(band)} style={{ fontFamily: 'monospace' }}>
          {label}
        </text>
      ) : null}
    </g>
  )
}

export function AnomalyOverlay(props: AnomalyOverlayProps): JSX.Element | null {
  const key = props.streamLogin ?? PRIMARY_STREAM_KEY
  const history = useIntelligenceStore((s) => s.slices[key]?.signalHistory ?? [])
  if (history.length === 0) return null
  const bands = computeBands(history as HistoryEntry[])
  if (bands.length === 0) return null
  return (
    <Fragment>
      {bands.map((band, idx) => (
        <ReferenceArea
          key={`${key}-${band.start}-${idx}`}
          x1={band.start}
          x2={band.end}
          ifOverflow="extendDomain"
          shape={(shapeProps: Record<string, unknown>) => (
            <BandShape
              x={shapeProps.x as number}
              y={shapeProps.y as number}
              width={shapeProps.width as number}
              height={shapeProps.height as number}
              band={band.band}
              label={props.label}
              stackOffset={props.stackOffset}
            />
          )}
        />
      ))}
    </Fragment>
  )
}
