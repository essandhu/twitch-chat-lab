import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { applyFilters } from '../filters/filterLogic'
import { ChatMessage } from '../chat/ChatMessage'
import { Badge } from '../../components/ui/Badge'
import type { ChatMessage as ChatMessageData } from '../../types/twitch'
import { isDuringSpikeFor } from './derivedIsDuringSpike'
import { useIntelligenceStore } from '../../store/intelligenceStore'

const MAX_ROWS = 1000
const ROW_ESTIMATED_HEIGHT = 40

interface SpotlightRow {
  key: string
  message: ChatMessageData
  sourceLogin: string
  sourceDisplayName: string
}

const mergeRows = (
  order: string[],
  streams: ReturnType<typeof useMultiStreamStore.getState>['streams'],
  filterState: Record<string, Parameters<typeof applyFilters>[1]>,
): SpotlightRow[] => {
  const merged: SpotlightRow[] = []
  for (const login of order) {
    const slice = streams[login]
    if (!slice) continue
    const filter = filterState[login]
    if (!filter) continue
    const spikeFn = isDuringSpikeFor(slice.dataPoints)
    const riskBandFor = () =>
      useIntelligenceStore.getState().slices[login]?.raidBand ?? 'calm'
    const matched = applyFilters(slice.messages, filter, spikeFn, riskBandFor)
    for (const message of matched) {
      merged.push({
        key: `${login}:${message.id}`,
        message,
        sourceLogin: login,
        sourceDisplayName: slice.displayName,
      })
    }
  }
  merged.sort((a, b) => a.message.timestamp.getTime() - b.message.timestamp.getTime())
  if (merged.length > MAX_ROWS) {
    return merged.slice(merged.length - MAX_ROWS)
  }
  return merged
}

export function SpotlightFeed(): JSX.Element {
  const streams = useMultiStreamStore((s) => s.streams)
  const order = useMultiStreamStore((s) => s.order)
  const filterState = useMultiStreamStore((s) => s.filterState)

  const rows = useMemo(
    () => mergeRows(order, streams, filterState),
    [order, streams, filterState],
  )

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATED_HEIGHT,
    overscan: 8,
  })

  if (rows.length === 0) {
    return (
      <div
        data-testid="spotlight-feed"
        className="flex h-full flex-col"
      >
        <p className="p-6 text-center text-text-muted">No matches</p>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div
      ref={parentRef}
      data-testid="spotlight-feed"
      className="h-full overflow-auto"
    >
      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((item) => {
          const row = rows[item.index]
          return (
            <div
              key={row.key}
              data-testid="spotlight-row"
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <div className="flex items-start gap-1 px-2 py-0.5">
                <Badge className="shrink-0 mt-0.5 font-mono text-[10px] px-1.5 py-0.5">
                  {row.sourceDisplayName}
                </Badge>
                <div className="min-w-0 flex-1">
                  <ChatMessage message={row.message} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
