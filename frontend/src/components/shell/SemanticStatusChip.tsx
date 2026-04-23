import { Tooltip } from '../ui/Tooltip'
import { useSemanticStore } from '../../store/semanticStore'

const STATUS_COPY = {
  loading: 'Semantic: loading…',
  ready: 'Semantic: ready',
  failed: 'Semantic: off',
} as const

const ICON = (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="mr-1 shrink-0">
    <circle cx="5" cy="5" r="3" fill="currentColor" />
  </svg>
)

export function SemanticStatusChip(): JSX.Element | null {
  const status = useSemanticStore((s) => s.status)

  if (status === 'idle') return null

  const label = STATUS_COPY[status]
  const colorClass =
    status === 'failed'
      ? 'text-text-muted border-danger/40'
      : status === 'loading'
        ? 'text-text border-warning/40'
        : 'text-success border-success/50'

  return (
    <Tooltip content={<span className="font-mono text-[11px]">{label}</span>} side="bottom">
      <span
        data-testid="semantic-status-chip"
        data-status={status}
        className={`inline-flex items-center rounded-sm border bg-surface/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] transition ${colorClass}`}
        aria-label={label}
      >
        {ICON}
        <span>{status}</span>
      </span>
    </Tooltip>
  )
}
