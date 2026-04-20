import { useEffect, useState } from 'react'
import { Tabs } from '../../components/ui/Tabs'
import { SpotlightFeed } from './SpotlightFeed'

const TAB_STORAGE_KEY = 'tcl.multi-dock.tab'
const DEFAULT_TAB = 'spotlight'

const readStoredTab = (): string => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TAB
    return localStorage.getItem(TAB_STORAGE_KEY) ?? DEFAULT_TAB
  } catch {
    return DEFAULT_TAB
  }
}

const storeTab = (tab: string): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TAB_STORAGE_KEY, tab)
  } catch {
    // ignore storage errors
  }
}

export function MultiStreamChatDock(): JSX.Element {
  const [tab, setTab] = useState<string>(() => readStoredTab())

  useEffect(() => {
    storeTab(tab)
  }, [tab])

  return (
    <div className="flex h-full flex-col">
      <Tabs.Root value={tab} onValueChange={setTab} className="flex h-full flex-col">
        <Tabs.List>
          <Tabs.Trigger value="spotlight">Spotlight</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="spotlight" className="flex-1 min-h-0 pt-0">
          <SpotlightFeed />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
