import { useChatStore } from '../store/chatStore'
import { useHeatmapStore } from '../store/heatmapStore'
import { applyFilters } from '../features/filters/filterLogic'
import type { ChatMessage } from '../types/twitch'

export function useChatMessages(): ChatMessage[] {
  const messages = useChatStore((s) => s.messages)
  const filterState = useChatStore((s) => s.filterState)
  const isDuringSpike = useHeatmapStore.getState().isDuringSpike
  return applyFilters(messages, filterState, isDuringSpike)
}
