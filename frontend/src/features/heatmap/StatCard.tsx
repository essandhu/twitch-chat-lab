import React from 'react'

interface Props {
  label: string
  value: string | number
  accent?: 'default' | 'peak'
}

const StatCardInner = ({ label, value, accent = 'default' }: Props) => {
  const valueColor = accent === 'peak' ? 'text-ember-400' : 'text-ink-100'
  return (
    <div className="border border-ink-800 bg-ink-900/40 px-4 py-3">
      <div className="text-ink-300 uppercase tracking-wider font-mono text-[10px]">
        {label}
      </div>
      <div className={`${valueColor} text-2xl font-display`}>{value}</div>
    </div>
  )
}

export const StatCard = React.memo(StatCardInner)
