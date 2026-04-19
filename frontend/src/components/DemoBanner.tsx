import { Button } from './ui/Button'

interface DemoBannerProps {
  onSignIn: () => void
}

export const DemoBanner = ({ onSignIn }: DemoBannerProps) => (
  <div
    role="status"
    aria-label="Demo mode"
    className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2"
  >
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
        Demo mode
      </span>
      <span className="hidden text-xs text-text-muted sm:inline">
        Read-only demo mode — chat is live but you cannot send messages or change channels.
      </span>
    </div>
    <Button type="button" variant="ghost" size="sm" onClick={onSignIn}>
      Sign in with Twitch
    </Button>
  </div>
)
