import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFilteredRows } from '../../hooks/useFilteredRows'
import { useVirtualChat } from '../../hooks/useVirtualChat'
import { ChatRowRenderer } from './ChatRowRenderer'
import { ChatScrollContext } from './chatScrollContext'
import { ScrollToBottom } from './ScrollToBottom'
import type { ChatMessage as ChatMessageType, ChatRow } from '../../types/twitch'

interface ChatListProps {
  messagesOverride?: ChatMessageType[]
}

const wrapAsRows = (messages: ChatMessageType[]): ChatRow[] =>
  messages.map((message) => ({ kind: 'message', id: message.id, message }))

export function ChatList({ messagesOverride }: ChatListProps = {}): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const storeRows = useFilteredRows()

  const rows = useMemo<ChatRow[]>(
    () => (messagesOverride ? wrapAsRows(messagesOverride) : storeRows),
    [messagesOverride, storeRows],
  )

  const virtualizer = useVirtualChat(rows, parentRef)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

  useEffect(() => {
    if (autoScrollEnabled && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    }
  }, [rows.length, autoScrollEnabled, virtualizer])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
    setAutoScrollEnabled(distanceFromBottom <= 100)
  }

  const jumpToLatest = () => {
    if (rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    }
    setAutoScrollEnabled(true)
  }

  const scrollToMessageId = useCallback(
    (messageId: string) => {
      const idx = rows.findIndex((r) => r.kind === 'message' && r.message.id === messageId)
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' })
    },
    [rows, virtualizer],
  )

  const items = virtualizer.getVirtualItems()

  try {
    performance.mark('virt-start')
  } catch {
    // Performance API unavailable; skip marks.
  }

  const rendered = items.map((item) => {
    const row = rows[item.index]!
    return (
      <div
        key={item.key}
        ref={virtualizer.measureElement}
        data-index={item.index}
        data-testid="chat-row"
        data-row-kind={row.kind}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${item.start}px)`,
        }}
      >
        <ChatRowRenderer row={row} />
      </div>
    )
  })

  try {
    performance.mark('virt-end')
    performance.measure('virt', 'virt-start', 'virt-end')
  } catch {
    // Performance API unavailable; skip marks.
  }

  return (
    <ChatScrollContext.Provider value={scrollToMessageId}>
      <div className="relative h-full">
        <div
          ref={parentRef}
          data-testid="chat-list"
          className="h-full overflow-y-auto"
          onScroll={handleScroll}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {rendered}
          </div>
        </div>
        <ScrollToBottom visible={!autoScrollEnabled} onClick={jumpToLatest} />
      </div>
    </ChatScrollContext.Provider>
  )
}
