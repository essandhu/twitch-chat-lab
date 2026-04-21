import type { ChatMessage, ExtractedSignalRef } from '../../types/twitch'

const WH_WORDS = new Set(['what', 'why', 'how', 'when', 'where', 'who', 'which'])
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const emoteOnlyRatio = (msg: ChatMessage): number => {
  const total = msg.fragments.length
  if (total === 0) return 0
  const emotes = msg.fragments.filter((f) => f.type === 'emote').length
  return emotes / total
}

export const extractQuestions = (msg: ChatMessage): ExtractedSignalRef | null => {
  const text = msg.text.trim()
  if (text.length <= 8) return null
  if (emoteOnlyRatio(msg) >= 0.5) return null
  const endsWithQ = text.endsWith('?')
  const firstWord = text.split(/\s+/u, 1)[0]?.toLowerCase() ?? ''
  const whStart = WH_WORDS.has(firstWord)
  if (!endsWithQ && !whStart) return null
  return { messageId: msg.id, kind: 'question', timestamp: msg.timestamp.getTime() }
}

const mentionRe = (ident: string): RegExp =>
  new RegExp(`(^|[^\\w])@${escapeRegExp(ident)}(?!\\w)`, 'iu')

export const extractCallouts = (
  msg: ChatMessage,
  broadcasterLogin: string,
  broadcasterDisplayName: string,
): ExtractedSignalRef | null => {
  if (mentionRe(broadcasterLogin).test(msg.text)) {
    return { messageId: msg.id, kind: 'callout', timestamp: msg.timestamp.getTime() }
  }
  if (broadcasterDisplayName && broadcasterDisplayName.toLowerCase() !== broadcasterLogin.toLowerCase()) {
    if (mentionRe(broadcasterDisplayName).test(msg.text)) {
      return { messageId: msg.id, kind: 'callout', timestamp: msg.timestamp.getTime() }
    }
  }
  return null
}

export const extractBitsContext = (msg: ChatMessage): ExtractedSignalRef | null => {
  if (msg.cheer == null) return null
  return { messageId: msg.id, kind: 'bitsContext', timestamp: msg.timestamp.getTime() }
}
