import type { FilterState } from '../../types/twitch'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { FilterPresetsMenu } from './FilterPresetsMenu'
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

export interface FilterToolbarProps {
  filterState: FilterState
  onFilterStateChange: (next: FilterState) => void
  onApplyToAllStreams?: (state: FilterState) => void
  mode?: 'single' | 'multi'
}

export const FilterToolbar = ({
  filterState,
  onFilterStateChange,
  onApplyToAllStreams,
  mode = 'single',
}: FilterToolbarProps) => {
  const activeCount = countActiveFilters(filterState)

  const toggle = (flag: ToggleFlag) =>
    onFilterStateChange({ ...filterState, [flag]: !filterState[flag] })

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {TOGGLES.map(({ flag, label }) => (
        <FilterToggle
          key={flag}
          label={label}
          active={filterState[flag]}
          onToggle={() => toggle(flag)}
        />
      ))}
      <KeywordFilter filterState={filterState} onFilterStateChange={onFilterStateChange} />
      <FilterPresetsMenu filterState={filterState} onFilterStateChange={onFilterStateChange} />
      {activeCount > 0 && (
        <Badge
          data-testid="filter-count"
          variant="accent"
          className="font-mono text-[10px] px-1.5 py-0.5"
        >
          {activeCount}
        </Badge>
      )}
      {mode === 'multi' && onApplyToAllStreams && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onApplyToAllStreams(filterState)}
          className="font-mono uppercase tracking-[0.22em]"
        >
          Apply to all
        </Button>
      )}
    </div>
  )
}
