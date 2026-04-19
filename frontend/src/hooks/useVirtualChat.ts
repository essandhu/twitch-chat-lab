import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatRow } from '../types/twitch'

const SIZE_BY_KIND: Record<ChatRow['kind'], number> = {
  message: 28,
  system: 44,
  deletion: 24,
  'chat-cleared': 32,
}

export function useVirtualChat(rows: ChatRow[], parentRef: RefObject<HTMLDivElement>) {
  return useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index]
      return row ? SIZE_BY_KIND[row.kind] : SIZE_BY_KIND.message
    },
    overscan: 5,
  })
}
