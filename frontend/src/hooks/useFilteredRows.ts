import { useMemo } from 'react'
import { useChatStore } from '../store/chatStore'
import { useHeatmapStore } from '../store/heatmapStore'
import { applyFilters } from '../features/filters/filterLogic'
import type { ChatRow } from '../types/twitch'

// System, deletion, and chat-cleared rows always pass through the filter
// toolbar per Feature 8 "Buffer and cap" rule — they are never hidden.
export function useFilteredRows(): ChatRow[] {
  const rows = useChatStore((s) => s.rows)
  const filterState = useChatStore((s) => s.filterState)
  const isDuringSpike = useHeatmapStore.getState().isDuringSpike

  return useMemo(() => {
    const hasActiveQuery = Boolean(filterState.query && filterState.query.trim().length > 0)
    const hasActiveFilter =
      filterState.firstTimeOnly ||
      filterState.subscribersOnly ||
      filterState.keyword.trim().length > 0 ||
      filterState.hypeModeOnly ||
      hasActiveQuery
    if (!hasActiveFilter) return rows

    return rows.filter((row) => {
      if (row.kind !== 'message') return true
      const kept = applyFilters([row.message], filterState, isDuringSpike)
      return kept.length > 0
    })
  }, [rows, filterState, isDuringSpike])
}
