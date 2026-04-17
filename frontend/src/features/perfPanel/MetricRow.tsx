import React from 'react'

interface Props {
  label: string
  value: string
  degraded?: boolean
  hint?: string
}

const MetricRowInner = ({ label, value, degraded = false, hint }: Props) => {
  const valueClass = degraded ? 'text-ember-400' : 'text-ink-100'
  const labelClass = 'text-[11px] font-mono uppercase tracking-wider text-ink-300'
  const labelNode = hint ? (
    <span className={labelClass} title={hint} aria-label={hint}>
      {label}
    </span>
  ) : (
    <span className={labelClass}>{label}</span>
  )
  return (
    <div className="flex items-baseline justify-between gap-3">
      {labelNode}
      <span className={`${valueClass} text-[12px] font-mono text-right`}>
        {value}
      </span>
    </div>
  )
}

export const MetricRow = React.memo(MetricRowInner)
