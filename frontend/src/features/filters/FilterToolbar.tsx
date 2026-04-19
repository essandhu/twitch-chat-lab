import { useChatStore } from '../../store/chatStore'
import type { FilterState } from '../../types/twitch'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { KeywordFilter } from './KeywordFilter'
import { countActiveFilters } from './filterLogic'

interface FilterToggleProps {
  label: string
  active: boolean
  onToggle: () => void
}

const FilterToggle = ({ label, active, onToggle }: FilterToggleProps) => (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    aria-pressed={active}
    data-state={active ? 'active' : 'inactive'}
    onClick={onToggle}
    className={cn(
      'font-mono uppercase tracking-[0.22em]',
      active && 'bg-accent text-accent-contrast border-accent hover:bg-accent-hover',
    )}
  >
    {label}
  </Button>
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
    <div className="relative flex flex-wrap items-center gap-2">
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
        <Badge
          data-testid="filter-count"
          variant="accent"
          className="font-mono text-[10px] px-1.5 py-0.5"
        >
          {activeCount}
        </Badge>
      )}
    </div>
  )
}
