import { useChatStore } from '../../store/chatStore'
import { FirstTimerEntry } from './FirstTimerEntry'

const INFO_TEXT =
  "First-time this session — EventSub does not expose 'first ever in channel' information."

export function FirstTimerPanel() {
  const firstTimers = useChatStore((s) => s.firstTimers)
  const reversed = [...firstTimers].reverse()

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
        <h2 className="font-display text-sm text-ink-100">First-Time Chatters</h2>
        <span
          className="text-ink-500 cursor-help"
          title={INFO_TEXT}
          aria-label={INFO_TEXT}
        >
          (i)
        </span>
        {firstTimers.length > 0 && (
          <span className="ml-auto rounded-full bg-ink-700 px-2 py-0.5 text-[10px] font-mono text-ember-500">
            {firstTimers.length}
          </span>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
        {reversed.map((entry) => (
          <FirstTimerEntry key={entry.userId} entry={entry} />
        ))}
      </div>
    </div>
  )
}
