import { useMultiStreamStore } from '../../store/multiStreamStore'
import { MultiStreamChatColumn } from './MultiStreamChatColumn'
import { stopCompare } from './multiStreamService'
import { Button } from '../../components/ui/Button'
import type { CSSProperties } from 'react'

export function MultiStreamLayout(): JSX.Element {
  const order = useMultiStreamStore((s) => s.order)

  const style = { ['--stream-count' as string]: Math.max(order.length, 1) } as CSSProperties

  const handleExit = (): void => {
    void stopCompare()
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={style}>
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent">
          Multi-stream · {order.length} {order.length === 1 ? 'channel' : 'channels'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExit}
          aria-label="Exit multi-stream mode"
        >
          Exit
        </Button>
      </div>
      <div className="grid flex-1 min-h-0 grid-cols-[repeat(var(--stream-count),minmax(0,1fr))] gap-0">
        {order.map((login) => (
          <MultiStreamChatColumn key={login} streamLogin={login} />
        ))}
      </div>
    </div>
  )
}
