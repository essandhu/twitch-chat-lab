import type { ChatMessage, FilterState } from '../../types/twitch'
import type { EvalContext, FilterQuery, RiskBand } from './filterQuery'
import { evaluate, parse } from './filterQuery'

export function countActiveFilters(state: FilterState): number {
  let n = 0
  if (state.firstTimeOnly) n++
  if (state.subscribersOnly) n++
  if (state.keyword !== '') n++
  if (state.hypeModeOnly) n++
  if (state.query && !state.queryError) n++
  return n
}

export function desugarToggles(state: FilterState): FilterQuery | null {
  const parts: FilterQuery[] = []
  if (state.firstTimeOnly) parts.push({ kind: 'preset', name: 'firstTimer' })
  if (state.subscribersOnly) parts.push({ kind: 'preset', name: 'sub' })
  if (state.hypeModeOnly) parts.push({ kind: 'preset', name: 'hype' })
  if (state.keyword !== '') parts.push({ kind: 'keyword', value: state.keyword })
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return { kind: 'and', children: parts }
}

const compose = (a: FilterQuery | null, b: FilterQuery | null): FilterQuery | null => {
  if (!a) return b
  if (!b) return a
  return { kind: 'and', children: [a, b] }
}

export function applyFilters(
  messages: ChatMessage[],
  state: FilterState,
  isDuringSpike: (ts: number) => boolean,
  riskBandFor?: () => RiskBand,
): ChatMessage[] {
  const toggleAst = desugarToggles(state)
  const rawQuery = state.query ?? ''
  const parsed = rawQuery.trim() ? parse(rawQuery) : { query: null, error: null }
  const composed = parsed.error ? toggleAst : compose(toggleAst, parsed.query)

  if (!composed) return messages

  const ctx: EvalContext = { isDuringSpike }
  if (riskBandFor) ctx.riskBandFor = riskBandFor
  return messages.filter((m) => {
    try {
      return evaluate(m, composed, ctx)
    } catch {
      return false
    }
  })
}
