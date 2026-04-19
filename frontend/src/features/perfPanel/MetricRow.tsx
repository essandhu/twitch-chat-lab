import React from 'react'
import { cn } from '../../lib/cn'

interface Props {
  label: string
  value: string
  degraded?: boolean
  hint?: string
}

const MetricRowInner = ({ label, value, degraded = false, hint }: Props) => {
  const rowClass = cn(
    'flex items-baseline justify-between gap-3 rounded px-1',
    degraded && 'bg-warning/10',
  )
  const valueClass = cn(
    'text-[12px] font-mono text-right',
    degraded ? 'text-warning' : 'text-text',
  )
  const labelClass = cn(
    'text-[11px] font-mono uppercase tracking-wider',
    degraded ? 'text-warning' : 'text-text-muted',
  )
  const labelNode = hint ? (
    <span className={labelClass} title={hint} aria-label={hint}>
      {label}
    </span>
  ) : (
    <span className={labelClass}>{label}</span>
  )
  return (
    <div className={rowClass}>
      {labelNode}
      <span className={valueClass}>{value}</span>
    </div>
  )
}

export const MetricRow = React.memo(MetricRowInner)
