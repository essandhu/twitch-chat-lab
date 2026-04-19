// Twitch Helix does not return a profile image URL with the chat events we
// subscribe to, and fetching one would require an extra Helix roundtrip per
// first-timer. We intentionally skip that and render an initials fallback via
// the Avatar primitive.
import { memo } from 'react'
import type { FirstTimerEntry as FirstTimerEntryData } from '../../types/twitch'
import { Avatar } from '../../components/ui/Avatar'
import { Card } from '../../components/ui/Card'

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 30) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

interface FirstTimerEntryProps {
  entry: FirstTimerEntryData
}

function FirstTimerEntryComponent({ entry }: FirstTimerEntryProps) {
  const initials = entry.displayName[0]?.toUpperCase() ?? '?'
  return (
    <Card role="article" className="animate-first-timer-slide-in px-3 py-2 text-sm">
      <div className="flex items-start gap-3">
        <Avatar.Root className="h-8 w-8 shrink-0">
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar.Root>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline">
            <a
              href={`https://twitch.tv/${entry.userLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${entry.displayName}'s Twitch page`}
              className="font-display text-text hover:text-accent underline-offset-2 hover:underline"
            >
              {entry.displayName}
            </a>
            <time className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {relativeTime(entry.timestamp)}
            </time>
          </div>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-text-muted">
            {entry.message}
          </p>
        </div>
      </div>
    </Card>
  )
}

export const FirstTimerEntry = memo(FirstTimerEntryComponent)
