import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatMessage } from '../types/twitch'

export function useVirtualChat(messages: ChatMessage[], parentRef: RefObject<HTMLDivElement>) {
  return useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 5,
  })
}
