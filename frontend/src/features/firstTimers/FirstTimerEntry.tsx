import { memo } from 'react'
import type { FirstTimerEntry as FirstTimerEntryData } from '../../types/twitch'

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
  return (
    <article className="animate-first-timer-slide-in border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm">
      <div className="flex items-baseline">
        <a
          href={`https://twitch.tv/${entry.userLogin}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${entry.displayName}'s Twitch page`}
          className="font-display text-ink-100 hover:text-ember-500 underline-offset-2 hover:underline"
        >
          {entry.displayName}
        </a>
        <time className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500 ml-2">
          {relativeTime(entry.timestamp)}
        </time>
      </div>
      <p className="mt-1 font-mono text-xs text-ink-300 whitespace-pre-wrap">{entry.message}</p>
    </article>
  )
}

export const FirstTimerEntry = memo(FirstTimerEntryComponent)
