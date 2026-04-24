import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent,
} from 'react'
import { Input } from '../ui/Input'
import { Avatar } from '../ui/Avatar'
import { cn } from '../../lib/cn'
import { logger } from '../../lib/logger'
import { twitchHelixClient } from '../../features/auth/authServices'
import { UnauthorizedError } from '../../services/TwitchHelixClient'
import type { HelixChannelSearchResult } from '../../types/twitch'

const DEBOUNCE_MS = 200
const RESULT_LIMIT = 8

export interface ChannelSearchProps {
  authed: boolean
  onSubmit: (login: string) => void
}

export const ChannelSearch = forwardRef<HTMLInputElement, ChannelSearchProps>(
  ({ authed, onSubmit }, ref) => {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<HelixChannelSearchResult[]>([])
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(-1)
    const containerRef = useRef<HTMLDivElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
      const trimmed = query.trim()
      if (!authed || !trimmed) {
        setResults([])
        setLoading(false)
        return
      }

      let cancelled = false
      setLoading(true)

      const handle = window.setTimeout(() => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        twitchHelixClient
          .searchChannels(trimmed, { first: RESULT_LIMIT, signal: controller.signal })
          .then((data) => {
            if (cancelled) return
            setResults(data)
            setLoading(false)
            setHighlight(data.length > 0 ? 0 : -1)
          })
          .catch((err: unknown) => {
            if (cancelled) return
            if (err instanceof DOMException && err.name === 'AbortError') return
            if (err instanceof UnauthorizedError) {
              setResults([])
              setLoading(false)
              return
            }
            logger.warn('channel_search.failed', { err: String(err) })
            setResults([])
            setLoading(false)
          })
      }, DEBOUNCE_MS)

      return () => {
        cancelled = true
        window.clearTimeout(handle)
      }
    }, [query, authed])

    useEffect(() => {
      if (!open) return
      const onClick = (e: MouseEvent) => {
        if (!containerRef.current) return
        if (!containerRef.current.contains(e.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    const commit = (login: string) => {
      const clean = login.trim().toLowerCase()
      if (!clean) return
      setOpen(false)
      onSubmit(clean)
    }

    const onChange = (e: ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value)
      setOpen(true)
      setHighlight(-1)
    }

    const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (authed && highlight >= 0 && results[highlight]) {
        commit(results[highlight].broadcaster_login)
      } else {
        commit(query)
      }
    }

    const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (!authed || results.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
        setHighlight((h) => (h + 1) % results.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
        setHighlight((h) => (h - 1 + results.length) % results.length)
      }
    }

    const trimmed = query.trim()
    const showUnauthedPanel = !authed && open && trimmed.length > 0
    const showResultsPanel = authed && open && trimmed.length > 0
    const showDropdown = showUnauthedPanel || showResultsPanel

    return (
      <div ref={containerRef} className="relative w-full">
        <form onSubmit={onFormSubmit}>
          <Input
            ref={ref}
            type="text"
            role="combobox"
            value={query}
            onChange={onChange}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={
              authed ? 'Search a Twitch channel…' : 'Sign in to search channels…'
            }
            aria-label="Channel search"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            aria-controls="channel-search-listbox"
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        {showDropdown && (
          <div
            id="channel-search-listbox"
            role={showResultsPanel ? 'listbox' : undefined}
            className="absolute left-0 right-0 top-full mt-1 max-h-[320px] overflow-y-auto rounded-md border border-border bg-surface-raised shadow-lg z-50"
          >
            {showUnauthedPanel && (
              <div className="px-3 py-3 text-xs text-text-muted" role="status">
                Sign in with Twitch to see channel suggestions. Press{' '}
                <kbd className="font-mono text-[11px]">Enter</kbd> to sign in and
                connect to &ldquo;{trimmed}&rdquo;.
              </div>
            )}
            {showResultsPanel && loading && results.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted">Searching…</div>
            )}
            {showResultsPanel && !loading && results.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted">
                No channels match &ldquo;{trimmed}&rdquo;.
              </div>
            )}
            {showResultsPanel &&
              results.map((r, idx) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={idx === highlight}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(r.broadcaster_login)
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-left border-0 cursor-pointer',
                    idx === highlight ? 'bg-surface-hover' : 'bg-transparent',
                  )}
                >
                  <Avatar.Root className="h-8 w-8 flex-shrink-0">
                    <Avatar.Image src={r.thumbnail_url} alt="" />
                    <Avatar.Fallback delayMs={400}>
                      {r.display_name.charAt(0).toUpperCase()}
                    </Avatar.Fallback>
                  </Avatar.Root>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text truncate">
                        {r.display_name}
                      </span>
                      {r.is_live && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-danger">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-danger"
                            aria-hidden="true"
                          />
                          live
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {r.is_live && r.game_name
                        ? `${r.game_name} · ${r.title}`
                        : `@${r.broadcaster_login}`}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>
    )
  },
)
ChannelSearch.displayName = 'ChannelSearch'
