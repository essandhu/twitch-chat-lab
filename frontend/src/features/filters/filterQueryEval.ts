import type { ChatMessage } from '../../types/twitch'
import type { FilterQuery } from './filterQueryParse'
import type { RiskBand, Role } from './filterQueryTokens'

export interface EvalContext {
  isDuringSpike: (ts: number) => boolean
  riskBandFor?: () => RiskBand
}

const hasBadge = (msg: ChatMessage, setId: string): boolean =>
  msg.badges.some((b) => b.setId === setId)

const matchesRole = (msg: ChatMessage, role: Role): boolean => {
  if (role === 'firstTimer') return msg.isFirstInSession
  if (role === 'mod') return hasBadge(msg, 'moderator')
  if (role === 'vip') return hasBadge(msg, 'vip')
  if (role === 'sub') return hasBadge(msg, 'subscriber')
  if (role === 'broadcaster') return hasBadge(msg, 'broadcaster')
  return false
}

const emoteCount = (msg: ChatMessage): number =>
  msg.fragments.filter((f) => f.type === 'emote').length

export const evaluate = (message: ChatMessage, query: FilterQuery, ctx: EvalContext): boolean => {
  switch (query.kind) {
    case 'and':
      return query.children.every((c) => evaluate(message, c, ctx))
    case 'or':
      return query.children.some((c) => evaluate(message, c, ctx))
    case 'not':
      return !evaluate(message, query.child, ctx)
    case 'keyword':
      return message.text.toLowerCase().includes(query.value.toLowerCase())
    case 'phrase':
      return message.text.toLowerCase().includes(query.value.toLowerCase())
    case 'regex':
      return query.pattern.test(message.text)
    case 'role':
      return matchesRole(message, query.role)
    case 'len':
      return query.op === '>' ? message.text.length > query.n : message.text.length < query.n
    case 'emotes':
      return emoteCount(message) > query.n
    case 'bits':
      return (message.cheer?.bits ?? 0) > query.n
    case 'user':
      return message.userLogin.toLowerCase() === query.login
    case 'preset':
      if (query.name === 'firstTimer') return message.isFirstInSession
      if (query.name === 'sub') return hasBadge(message, 'subscriber')
      if (query.name === 'hype') return ctx.isDuringSpike(message.timestamp.getTime())
      return false
    case 'risk':
      if (!ctx.riskBandFor) throw new Error('risk_token_reserved_for_phase_9')
      return ctx.riskBandFor() === query.band
  }
}
