import { useChatStore } from '../../store/chatStore'

export const KeywordFilter = () => {
  const keyword = useChatStore((s) => s.filterState.keyword)
  const setFilterState = useChatStore((s) => s.setFilterState)

  return (
    <div className="inline-flex items-center border border-ink-700 bg-ink-900">
      <input
        type="text"
        aria-label="Keyword filter"
        placeholder="Filter by keyword..."
        value={keyword}
        onChange={(e) => setFilterState({ keyword: e.target.value })}
        className="bg-transparent text-ink-100 placeholder:text-ink-500 text-xs font-mono px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ember-500"
      />
      {keyword !== '' && (
        <button
          type="button"
          aria-label="Clear keyword"
          onClick={() => setFilterState({ keyword: '' })}
          className="px-2 py-1 text-ink-500 hover:text-ember-500 font-mono text-xs"
        >
          ×
        </button>
      )}
    </div>
  )
}
