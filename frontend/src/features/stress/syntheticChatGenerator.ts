import type {
  ChannelChatMessageEvent,
  ChatMessage,
  RawBadge,
  RawMessageFragment,
} from '../../types/twitch'

// mulberry32 seeded PRNG — deterministic replacement for Math.random().
const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const USERNAMES = ['gigachat99', 'emotepatrol', 'lurker_prime', 'chatterbox42', 'vod_watcher', 'firstpog', 'hypeenjoyer', 'sixtytwofps']
const BADGE_POOLS: RawBadge[][] = [
  [{ set_id: 'subscriber', id: '0', info: '1' }],
  [{ set_id: 'moderator', id: '1', info: '' }],
  [{ set_id: 'vip', id: '1', info: '' }],
  [{ set_id: 'bits', id: '100', info: '100' }],
  [],
]
const EMOTES = ['Kappa', 'PogChamp', 'LUL', 'KEKW', 'EZ', 'PepeLaugh']
const TEMPLATES = [
  'hello chat {emote}', '{emote} {emote} {emote}', 'nice play {emote}', 'first time seeing this',
  'what a moment {emote}', 'lets go!!', 'gg {emote}', '!uptime', 'clip it clip it', 'who is this streamer',
]
const COLORS = ['#FF4500', '#1E90FF', '#00FF7F', '#FFD700', '#FF69B4', '#8A2BE2']

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!

const buildFragments = (text: string): RawMessageFragment[] => {
  const out: RawMessageFragment[] = []
  for (const part of text.split(/(\S+)/)) {
    if (!part) continue
    if (EMOTES.includes(part)) out.push({ type: 'emote', text: part, emote: { id: `em_${part}` } })
    else out.push({ type: 'text', text: part })
  }
  return out
}

export interface SyntheticBundle {
  message: ChatMessage
  event: ChannelChatMessageEvent
}

export const buildSyntheticBundle = (seed: number, now: number): SyntheticBundle => {
  const rng = mulberry32(seed)
  const userIdx = Math.floor(rng() * USERNAMES.length)
  const userLogin = USERNAMES[userIdx]!
  const userId = `u_${seed >>> 0}_${userIdx}`
  const badges = pick(rng, BADGE_POOLS)
  const color = pick(rng, COLORS)
  const template = pick(rng, TEMPLATES)
  const emote = pick(rng, EMOTES)
  const text = template.replace(/\{emote\}/g, emote)
  const fragments = buildFragments(text)
  const messageId = `syn_${(seed >>> 0).toString(36)}`
  const event: ChannelChatMessageEvent = {
    broadcaster_user_id: 'stress_bcast',
    broadcaster_user_login: 'stress',
    broadcaster_user_name: 'stress',
    chatter_user_id: userId,
    chatter_user_login: userLogin,
    chatter_user_name: userLogin,
    message_id: messageId,
    message: { text, fragments },
    color,
    badges,
    message_type: 'text',
  }
  const message: ChatMessage = {
    id: messageId,
    userId,
    userLogin,
    displayName: userLogin,
    color,
    badges: badges.map((b) => ({ setId: b.set_id, id: b.id, info: b.info })),
    fragments: fragments.map((f) =>
      f.type === 'emote' ? { type: 'emote', text: f.text, emote: { id: f.emote.id } } : { type: 'text', text: f.text },
    ),
    text,
    isFirstInSession: false,
    isHighlighted: false,
    timestamp: new Date(now),
    messageType: 'text',
  }
  return { message, event }
}

export const buildSyntheticMessage = (seed: number, now: number): ChatMessage =>
  buildSyntheticBundle(seed, now).message
