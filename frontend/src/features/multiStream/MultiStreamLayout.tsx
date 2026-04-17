import { useMultiStreamStore } from '../../store/multiStreamStore'
import { MultiStreamChatColumn } from './MultiStreamChatColumn'
import { stopCompare } from './multiStreamService'
import type { CSSProperties } from 'react'

export function MultiStreamLayout(): JSX.Element {
  const order = useMultiStreamStore((s) => s.order)

  const style = { ['--stream-count' as string]: Math.max(order.length, 1) } as CSSProperties

  const handleExit = (): void => {
    void stopCompare()
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={style}>
      <div className="flex items-center justify-between border-b border-ink-800 bg-ink-900/40 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ember-500">
          Multi-stream · {order.length} {order.length === 1 ? 'channel' : 'channels'}
        </span>
        <button
          type="button"
          onClick={handleExit}
          aria-label="Exit multi-stream mode"
          className="border border-ink-700 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-100 hover:bg-ink-800"
        >
          Exit
        </button>
      </div>
      <div className="grid flex-1 min-h-0 grid-cols-[repeat(var(--stream-count),minmax(0,1fr))] gap-0">
        {order.map((login) => (
          <MultiStreamChatColumn key={login} streamLogin={login} />
        ))}
      </div>
    </div>
  )
}
