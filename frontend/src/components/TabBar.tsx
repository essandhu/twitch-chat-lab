export interface Tab {
  id: string
  label: string
  badgeCount?: number
}

export interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onTabChange: (id: string) => void
}

export function TabBar({ tabs, activeTabId, onTabChange }: TabBarProps): JSX.Element {
  return (
    <div role="tablist" className="flex flex-row">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const showBadge = tab.badgeCount !== undefined && tab.badgeCount > 0
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 transition font-mono text-xs uppercase tracking-[0.2em] border-b-2 ${
              isActive
                ? 'border-ember-500 text-ink-100'
                : 'border-transparent text-ink-500 hover:text-ink-300'
            }`}
          >
            {tab.label}
            {showBadge && (
              <span className="ml-2 rounded-full bg-ink-700 px-1.5 py-0.5 text-[10px] text-ember-500">
                {tab.badgeCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
