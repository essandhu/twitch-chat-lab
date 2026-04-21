import { useChatStore } from '../store/chatStore'
import { useHeatmapStore } from '../store/heatmapStore'
import { applyFilters } from '../features/filters/filterLogic'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../store/intelligenceStore'
import type { ChatMessage } from '../types/twitch'

export function useChatMessages(): ChatMessage[] {
  const messages = useChatStore((s) => s.messages)
  const filterState = useChatStore((s) => s.filterState)
  const isDuringSpike = useHeatmapStore.getState().isDuringSpike
  const riskBandFor = () =>
    useIntelligenceStore.getState().slices[PRIMARY_STREAM_KEY]?.raidBand ?? 'calm'
  return applyFilters(messages, filterState, isDuringSpike, riskBandFor)
}
