import type { FilterState } from '../../types/twitch'
import { parse } from './filterQuery'

interface KeywordFilterProps {
  filterState: FilterState
  onFilterStateChange: (next: FilterState) => void
}

export const KeywordFilter = ({ filterState, onFilterStateChange }: KeywordFilterProps) => {
  const value = filterState.query ?? ''
  const error = filterState.queryError ?? null

  const updateQuery = (nextValue: string): void => {
    if (nextValue === '') {
      onFilterStateChange({ ...filterState, query: '', queryError: null })
      return
    }
    const { error: parseError } = parse(nextValue)
    onFilterStateChange({ ...filterState, query: nextValue, queryError: parseError })
  }

  return (
    <div className="flex min-w-0 flex-1 basis-full flex-col">
      <div className="flex min-w-0 items-center rounded-md border border-border bg-surface">
        <input
          type="text"
          aria-label="Keyword filter"
          placeholder={'kw:"pog" AND role:sub'}
          value={value}
          onChange={(e) => updateQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-text placeholder:text-text-muted text-xs font-mono px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {value !== '' && (
          <button
            type="button"
            aria-label="Clear query"
            onClick={() => updateQuery('')}
            className="px-2 py-1 text-text-muted hover:text-accent font-mono text-xs"
          >
            ×
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-warning font-mono px-1 pt-1">
          {error}
        </p>
      )}
    </div>
  )
}
