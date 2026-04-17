import { useEffect, useRef, useState } from 'react'
import { useChatMessages } from '../../hooks/useChatMessages'
import { useVirtualChat } from '../../hooks/useVirtualChat'
import { ChatMessage } from './ChatMessage'
import { ScrollToBottom } from './ScrollToBottom'

export function ChatList(): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const messages = useChatMessages()
  const virtualizer = useVirtualChat(messages, parentRef)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

  useEffect(() => {
    if (autoScrollEnabled && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [messages.length, autoScrollEnabled, virtualizer])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
    setAutoScrollEnabled(distanceFromBottom <= 100)
  }

  const jumpToLatest = () => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
    setAutoScrollEnabled(true)
  }

  const items = virtualizer.getVirtualItems()

  try {
    performance.mark('virt-start')
  } catch {
    // Performance API unavailable; skip marks.
  }

  const rendered = items.map((item) => (
    <div
      key={item.key}
      ref={virtualizer.measureElement}
      data-index={item.index}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${item.start}px)`,
      }}
    >
      <ChatMessage message={messages[item.index]!} />
    </div>
  ))

  try {
    performance.mark('virt-end')
    performance.measure('virt', 'virt-start', 'virt-end')
  } catch {
    // Performance API unavailable; skip marks.
  }

  return (
    <div className="relative h-full">
      <div ref={parentRef} className="h-full overflow-y-auto" onScroll={handleScroll}>
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
  )
}
