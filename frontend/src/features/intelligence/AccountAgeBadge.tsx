import type { AccountAgeBucket } from '../../types/twitch'

interface Props {
  source: 'helix' | 'approximate' | undefined
  bucket: AccountAgeBucket
}

export function AccountAgeBadge({ source }: Props): JSX.Element | null {
  if (source !== 'approximate') return null
  return (
    <span
      data-testid="account-age-badge-approximate"
      className="ml-1 rounded-sm border border-border/60 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-text-muted"
      title="Account age estimated from user-id heuristic (Helix unavailable)"
    >
      approximate
    </span>
  )
}
