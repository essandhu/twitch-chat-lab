import { useContext, useMemo } from 'react'
import { logger } from '../../lib/logger'
import type { ChatMessage, ExtractedSignalKind, ExtractedSignalRef } from '../../types/twitch'
import { ChatScrollContext } from '../chat/chatScrollContext'

interface Props {
  kind: ExtractedSignalKind
  refs: ExtractedSignalRef[]
  resolve: (id: string) => ChatMessage | undefined
  canScroll: boolean
  streamLogin?: string
}

const MAX_ROWS = 50

const emptyMessage = (kind: ExtractedSignalKind): string => {
  if (kind === 'question') return 'No questions yet'
  if (kind === 'callout') return 'No callouts yet'
  return 'No bits messages yet'
}

let warned = false

export function ExtractedSignalList({ kind, refs, resolve, canScroll, streamLogin }: Props): JSX.Element {
  const scrollTo = useContext(ChatScrollContext)
  const rows = useMemo(() => refs.slice(-MAX_ROWS).reverse(), [refs])

  if (rows.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-6 text-center text-xs text-text-muted"
        data-testid={`intelligence-empty-${kind}`}
      >
        {emptyMessage(kind)}
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
        const preview = msg ? msg.text : '(message evicted)'
        return (
          <li
            key={ref.messageId}
            data-testid="intelligence-row"
            data-kind={kind}
            data-message-id={ref.messageId}
          >
            <button
              type="button"
              onClick={() => handleClick(ref.messageId)}
              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-text-muted">
                  {msg?.displayName ?? '?'}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                  {new Date(ref.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <span className="truncate text-sm text-text">{preview}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
