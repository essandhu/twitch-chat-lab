import { useState, type CSSProperties } from 'react'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { HeatmapPanel } from '../heatmap/HeatmapPanel'
import { MultiStreamChatColumn } from './MultiStreamChatColumn'
import { stopCompare } from './multiStreamService'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'

type MultiStreamView = 'streams' | 'heatmap'

export function MultiStreamLayout(): JSX.Element {
  const order = useMultiStreamStore((s) => s.order)
  const [view, setView] = useState<MultiStreamView>('streams')

  const style = { ['--stream-count' as string]: Math.max(order.length, 1) } as CSSProperties

  const handleExit = (): void => {
    void stopCompare()
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={style}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent">
          Multi-stream · {order.length} {order.length === 1 ? 'channel' : 'channels'}
        </span>
        <div className="flex items-center gap-3">
          <div
            role="tablist"
            aria-label="Multi-stream view"
            className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
          >
            <ViewToggle
              active={view === 'streams'}
              onClick={() => setView('streams')}
              label="Streams"
            />
            <ViewToggle
              active={view === 'heatmap'}
              onClick={() => setView('heatmap')}
              label="Heatmap"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExit}
            aria-label="Exit multi-stream mode"
          >
            Exit
          </Button>
        </div>
      </div>
      {view === 'streams' ? (
        <div className="grid flex-1 min-h-0 grid-cols-[repeat(var(--stream-count),minmax(0,1fr))] gap-0">
          {order.map((login) => (
            <MultiStreamChatColumn key={login} streamLogin={login} />
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <HeatmapPanel />
        </div>
      )}
    </div>
  )
}

interface ViewToggleProps {
  active: boolean
  onClick: () => void
  label: string
}

const ViewToggle = ({ active, onClick, label }: ViewToggleProps): JSX.Element => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={cn(
      'rounded px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
      active
        ? 'bg-accent text-accent-contrast'
        : 'text-text-muted hover:bg-surface-hover hover:text-text',
    )}
  >
    {label}
  </button>
)
