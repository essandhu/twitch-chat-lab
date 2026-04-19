import { memo, useMemo } from 'react'

export const cheerTierColor = (bits: number): string => {
  if (bits >= 10000) return '#EF4444'
  if (bits >= 5000) return '#3B82F6'
  if (bits >= 1000) return '#10B981'
  if (bits >= 100) return '#8B5CF6'
  return '#9CA3AF'
}

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface CheerPillProps {
  bits: number
}

function CheerPillInner({ bits }: CheerPillProps) {
  const color = cheerTierColor(bits)
  const reduceMotion = useMemo(() => prefersReducedMotion(), [])
  const className = reduceMotion
    ? 'inline-flex items-center px-2 py-0.5 mr-1 rounded-full text-xs font-semibold border border-current'
    : 'inline-flex items-center px-2 py-0.5 mr-1 rounded-full text-xs font-semibold border border-current cheer-pill-bounce'
  return (
    <span className={className} style={{ color }}>
      cheered {bits} bits
    </span>
  )
}

export const CheerPill = memo(CheerPillInner)
