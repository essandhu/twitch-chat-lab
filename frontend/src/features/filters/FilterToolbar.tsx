import { useChatStore } from '../../store/chatStore'
import type { FilterState } from '../../types/twitch'
import { KeywordFilter } from './KeywordFilter'
import { countActiveFilters } from './filterLogic'

interface FilterToggleProps {
  label: string
  active: boolean
  onToggle: () => void
}

const FilterToggle = ({ label, active, onToggle }: FilterToggleProps) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onToggle}
    className={`text-xs font-mono uppercase tracking-[0.2em] px-3 py-1.5 rounded-sm transition ${
      active ? 'bg-ember-500 text-ink-950' : 'bg-ink-800 text-ink-300 hover:bg-ink-700'
    }`}
  >
    {label}
  </button>
)

type ToggleFlag = 'firstTimeOnly' | 'subscribersOnly' | 'hypeModeOnly'

const TOGGLES: ReadonlyArray<{ flag: ToggleFlag; label: string }> = [
  { flag: 'firstTimeOnly', label: 'First-Timers' },
  { flag: 'subscribersOnly', label: 'Subscribers' },
  { flag: 'hypeModeOnly', label: 'Hype Mode' },
]

export const FilterToolbar = () => {
  const filterState = useChatStore((s) => s.filterState)
  const setFilterState = useChatStore((s) => s.setFilterState)
  const activeCount = countActiveFilters(filterState)

  return (
    <div className="relative flex items-center gap-2">
      {TOGGLES.map(({ flag, label }) => (
        <FilterToggle
          key={flag}
          label={label}
          active={filterState[flag]}
          onToggle={() => setFilterState({ [flag]: !filterState[flag] } as Partial<FilterState>)}
        />
      ))}
      <KeywordFilter />
      {activeCount > 0 && (
        <span
          data-testid="filter-count"
          className="absolute top-1 right-1 rounded-full bg-ember-500 text-ink-950 text-[10px] font-mono px-1.5 py-0.5"
        >
          {activeCount}
        </span>
      )}
    </div>
  )
}
