import { useContext, useEffect, useMemo, useState } from 'react'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import { useSafeMode } from '../../hooks/useSafeMode'
import { censorText } from '../../lib/profanityFilter'
import { tokenRgba } from '../../lib/theme'
import { useChatStore } from '../../store/chatStore'
import { useSemanticStore } from '../../store/semanticStore'
import { ChatScrollContext } from '../chat/chatScrollContext'

const DEBOUNCE_MS = 150
const PREVIEW_CHARS = 40

const truncate = (text: string): string => (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text)

export function SemanticSearch(): JSX.Element {
  const [input, setInput] = useState('')
  const status = useSemanticStore((s) => s.status)
  const results = useSemanticStore((s) => s.searchResults)
  const setSearchQuery = useSemanticStore((s) => s.setSearchQuery)
  const runSearch = useSemanticStore((s) => s.runSearch)
  const messagesById = useChatStore((s) => s.messagesById)
  const scrollTo = useContext(ChatScrollContext)
  const { safeMode } = useSafeMode()

  useEffect(() => {
    setSearchQuery(input)
    const handle = setTimeout(() => {
      void runSearch(Date.now())
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [input, setSearchQuery, runSearch])

  const disabled = status !== 'ready'
  const emptyState = useMemo(() => {
    if (status === 'loading') return 'Semantic is loading…'
    if (status === 'idle') return 'Semantic search not activated.'
    if (status === 'failed') return 'Semantic search unavailable.'
    if (input.trim().length < 2) return 'Type at least 2 characters.'
    if (results.length === 0) return 'No matches.'
    return null
  }, [status, input, results.length])

  const handleClick = (messageId: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    scrollTo(messageId)
    const el = e.currentTarget
    el.setAttribute('data-highlight', 'semantic')
    setTimeout(() => el.removeAttribute('data-highlight'), 800)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Semantic search"
          placeholder={disabled ? emptyState ?? 'Loading…' : 'Search chat meaning…'}
          data-testid="semantic-search-input"
          disabled={status === 'failed'}
        />
      </div>
      <ul className="flex-1 min-h-0 divide-y divide-border/60 overflow-auto">
        {status === 'loading' && results.length === 0 && (
          <li className="p-3">
            <Skeleton className="h-3 w-3/4" />
          </li>
        )}
        {emptyState && results.length === 0 && status !== 'loading' && (
          <li className="p-6 text-center text-xs text-text-muted" data-testid="semantic-empty">
            {emptyState}
          </li>
        )}
        {results.map((r) => {
          const msg = messagesById[r.messageId]
          return (
            <li key={r.messageId} data-testid="semantic-result-row" data-score={r.score.toFixed(3)}>
              <button
                type="button"
                onClick={handleClick(r.messageId)}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover data-[highlight=semantic]:bg-accent/20"
              >
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-text-muted">
                  <span className="truncate">{msg?.displayName ?? '?'}</span>
                  <span className="shrink-0 tabular-nums">
                    {msg ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>
                <span className="truncate text-sm text-text">{msg ? truncate(censorText(msg.text, safeMode)) : '(evicted)'}</span>
                <span
                  className="mt-1 block h-1 w-full rounded-full"
                  aria-hidden="true"
                  style={{ backgroundColor: tokenRgba('accent', 0.12) }}
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(1, r.score)) * 100}%`,
                      backgroundColor: tokenRgba('accent', 0.85),
                    }}
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
