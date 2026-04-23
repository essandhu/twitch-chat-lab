import { useContext, useMemo } from 'react'
import { logger } from '../../lib/logger'
import { censorText } from '../../lib/profanityFilter'
import { useSafeMode } from '../../hooks/useSafeMode'
import type { AccountAgeRecord, ChatMessage, ExtractedSignalKind, ExtractedSignalRef } from '../../types/twitch'
import { ChatScrollContext } from '../chat/chatScrollContext'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../../store/intelligenceStore'
import { AccountAgeBadge } from './AccountAgeBadge'
import { Badge } from '../../components/ui/Badge'

interface Props {
  kind: ExtractedSignalKind
  refs: ExtractedSignalRef[]
  resolve: (id: string) => ChatMessage | undefined
  canScroll: boolean
  streamLogin?: string
  streamBadgeByMessageId?: Record<string, string>
  accountAgeByUserId?: Record<string, AccountAgeRecord>
}

const MAX_ROWS = 50
const EMPTY: Record<ExtractedSignalKind, string> = {
  question: 'No questions yet',
  callout: 'No callouts yet',
  bitsContext: 'No bits messages yet',
}

let warned = false

export function ExtractedSignalList({
  kind,
  refs,
  resolve,
  canScroll,
  streamLogin,
  streamBadgeByMessageId,
  accountAgeByUserId,
}: Props): JSX.Element {
  const scrollTo = useContext(ChatScrollContext)
  const { safeMode } = useSafeMode()
  const rows = useMemo(() => refs.slice(-MAX_ROWS).reverse(), [refs])
  const sliceAccountAge = useIntelligenceStore(
    (s) => s.slices[streamLogin ?? PRIMARY_STREAM_KEY]?.accountAge ?? {},
  )
  const accountAgeByUser = accountAgeByUserId ?? sliceAccountAge

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-text-muted" data-testid={`intelligence-empty-${kind}`}>
        {EMPTY[kind]}
      </div>
    )
  }

  const handleClick = (id: string) => {
    if (!canScroll) {
      if (!warned) {
        warned = true
        logger.warn('intelligence.scroll.unmounted', { streamLogin: streamLogin ?? 'primary' })
      }
      return
    }
    scrollTo(id)
  }

  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {rows.map((ref) => {
        const msg = resolve(ref.messageId)
        const age = msg ? accountAgeByUser[msg.userId] : undefined
        const streamBadge = streamBadgeByMessageId?.[ref.messageId]
        return (
          <li key={ref.messageId} data-testid="intelligence-row" data-kind={kind} data-message-id={ref.messageId}>
            <button type="button" onClick={() => handleClick(ref.messageId)} className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-1.5 truncate font-mono text-[11px] text-text-muted">
                  {streamBadge ? (
                    <Badge
                      data-testid="intelligence-row-stream-badge"
                      className="shrink-0 font-mono text-[10px] px-1.5 py-0"
                    >
                      {streamBadge}
                    </Badge>
                  ) : null}
                  <span className="truncate">{msg?.displayName ?? '?'}</span>
                  {age ? <AccountAgeBadge source={age.source} bucket={age.bucket} /> : null}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                  {new Date(ref.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <span className="truncate text-sm text-text">{msg ? censorText(msg.text, safeMode) : '(message evicted)'}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
