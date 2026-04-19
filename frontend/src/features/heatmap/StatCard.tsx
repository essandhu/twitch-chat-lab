import React from 'react'
import { Card } from '../../components/ui/Card'

interface Props {
  label: string
  value: string | number
  accent?: 'default' | 'peak'
}

const StatCardInner = ({ label, value, accent = 'default' }: Props) => {
  const valueColor = accent === 'peak' ? 'text-accent' : 'text-text'
  return (
    <Card>
      <Card.Body className="p-4">
        <div className="text-text-muted uppercase tracking-wider font-mono text-[10px]">
          {label}
        </div>
        <div className={`${valueColor} text-2xl font-display`}>{value}</div>
      </Card.Body>
    </Card>
  )
}

export const StatCard = React.memo(StatCardInner)
