import type { ChatMessage, FilterState } from '../../types/twitch'

/**
 * Count how many filters in `state` are currently active.
 *
 * A filter is "active" when:
 *   - firstTimeOnly === true
 *   - subscribersOnly === true
 *   - keyword is a non-empty string
 *   - hypeModeOnly === true
 */
export function countActiveFilters(state: FilterState): number {
  let n = 0
  if (state.firstTimeOnly) n++
  if (state.subscribersOnly) n++
  if (state.keyword !== '') n++
  if (state.hypeModeOnly) n++
  return n
}

/**
 * Pure filter application over a list of chat messages.
 *
 * Composition is logical AND across all active filters. When no filters are
 * active, returns the INPUT array reference (no copy) so downstream React
 * memoization can short-circuit via referential equality.
 *
 * `isDuringSpike` is injected — this function takes no dependency on any
 * module-level state or store.
 */
export function applyFilters(
  messages: ChatMessage[],
  state: FilterState,
  isDuringSpike: (ts: number) => boolean,
): ChatMessage[] {
  const { firstTimeOnly, subscribersOnly, keyword, hypeModeOnly } = state
  const keywordActive = keyword !== ''

  if (!firstTimeOnly && !subscribersOnly && !keywordActive && !hypeModeOnly) {
    return messages
  }

  const loweredKeyword = keywordActive ? keyword.toLowerCase() : ''

  return messages.filter((message) => {
    if (firstTimeOnly && !message.isFirstInSession) return false
    if (subscribersOnly && !message.badges.some((b) => b.setId === 'subscriber')) return false
    if (keywordActive && !message.text.toLowerCase().includes(loweredKeyword)) return false
    if (hypeModeOnly && !isDuringSpike(message.timestamp.getTime())) return false
    return true
  })
}
