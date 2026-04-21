import { describe, expect, it } from 'vitest'
import type { Badge, ChatMessage, MessageFragment } from '../../types/twitch'
import type { EvalContext } from './filterQueryEval'
import { evaluate } from './filterQueryEval'
import { parse } from './filterQueryParse'

const baseCtx: EvalContext = { isDuringSpike: () => false }

const makeMsg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'id',
  userId: 'uid',
  userLogin: 'alice',
  displayName: 'Alice',
  color: '#fff',
  badges: [],
  fragments: [],
  text: 'hello world',
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(1_700_000_000_000),
  messageType: 'text',
  ...overrides,
})

const badge = (setId: string): Badge => ({ setId, id: '1', info: '' })
const textFrag = (text: string): MessageFragment => ({ type: 'text', text })
const emoteFrag = (): MessageFragment => ({ type: 'emote', text: ':p', emote: { id: 'e1' } })

const evalSrc = (src: string, msg: ChatMessage, ctx: EvalContext = baseCtx): boolean => {
  const { query, error } = parse(src)
  if (error) throw new Error(`parse error: ${error}`)
  if (!query) throw new Error('no query')
  return evaluate(msg, query, ctx)
}

describe('evaluate — per-token semantics', () => {
  it('keyword: case-insensitive substring match', () => {
    expect(evalSrc('HELLO', makeMsg({ text: 'Hello there' }))).toBe(true)
    expect(evalSrc('nope', makeMsg({ text: 'Hello there' }))).toBe(false)
  })

  it('phrase: case-insensitive substring match on quoted', () => {
    expect(evalSrc('kw:"Hello There"', makeMsg({ text: 'say hello there friend' }))).toBe(true)
    expect(evalSrc('kw:"no match"', makeMsg({ text: 'hello there friend' }))).toBe(false)
  })

  it('regex matches with flags', () => {
    expect(evalSrc('regex:/FOO\\d+/i', makeMsg({ text: 'foo42' }))).toBe(true)
    expect(evalSrc('regex:/^x/', makeMsg({ text: 'not starting with x' }))).toBe(false)
  })

  it('role:mod matches moderator badge', () => {
    expect(evalSrc('role:mod', makeMsg({ badges: [badge('moderator')] }))).toBe(true)
    expect(evalSrc('role:mod', makeMsg({ badges: [] }))).toBe(false)
  })

  it('role:vip matches vip badge', () => {
    expect(evalSrc('role:vip', makeMsg({ badges: [badge('vip')] }))).toBe(true)
  })

  it('role:sub matches subscriber badge', () => {
    expect(evalSrc('role:sub', makeMsg({ badges: [badge('subscriber')] }))).toBe(true)
  })

  it('role:broadcaster matches broadcaster badge', () => {
    expect(evalSrc('role:broadcaster', makeMsg({ badges: [badge('broadcaster')] }))).toBe(true)
  })

  it('role:firstTimer matches isFirstInSession', () => {
    expect(evalSrc('role:firstTimer', makeMsg({ isFirstInSession: true }))).toBe(true)
    expect(evalSrc('role:firstTimer', makeMsg({ isFirstInSession: false }))).toBe(false)
  })

  it('len>N and len<N thresholds', () => {
    expect(evalSrc('len>3', makeMsg({ text: 'four' }))).toBe(true)
    expect(evalSrc('len>3', makeMsg({ text: 'abc' }))).toBe(false)
    expect(evalSrc('len<5', makeMsg({ text: 'abc' }))).toBe(true)
    expect(evalSrc('len<5', makeMsg({ text: 'abcdef' }))).toBe(false)
  })

  it('emotes>N counts emote fragments', () => {
    const withEmotes = makeMsg({ fragments: [textFrag('hi '), emoteFrag(), emoteFrag()] })
    expect(evalSrc('emotes>1', withEmotes)).toBe(true)
    expect(evalSrc('emotes>3', withEmotes)).toBe(false)
  })

  it('bits>N matches cheer bits', () => {
    expect(evalSrc('bits>100', makeMsg({ cheer: { bits: 500 } }))).toBe(true)
    expect(evalSrc('bits>100', makeMsg({ cheer: { bits: 50 } }))).toBe(false)
    expect(evalSrc('bits>100', makeMsg())).toBe(false)
  })

  it('user:login matches case-insensitive login', () => {
    expect(evalSrc('user:ALICE', makeMsg({ userLogin: 'alice' }))).toBe(true)
    expect(evalSrc('user:bob', makeMsg({ userLogin: 'alice' }))).toBe(false)
  })

  it('preset firstTimer / sub / hype', () => {
    expect(evalSrc('firstTimer', makeMsg({ isFirstInSession: true }))).toBe(true)
    expect(evalSrc('sub', makeMsg({ badges: [badge('subscriber')] }))).toBe(true)
    const hypeCtx: EvalContext = { isDuringSpike: () => true }
    expect(evalSrc('hype', makeMsg(), hypeCtx)).toBe(true)
    expect(evalSrc('hype', makeMsg())).toBe(false)
  })

  it('risk: throws reserved error when riskBandFor absent', () => {
    expect(() => evalSrc('risk:elevated', makeMsg())).toThrow('risk_token_reserved_for_phase_9')
  })
})

describe('evaluate — boolean composition', () => {
  it('AND requires both', () => {
    const msg = makeMsg({ text: 'pog', badges: [badge('subscriber')] })
    expect(evalSrc('pog AND sub', msg)).toBe(true)
    expect(evalSrc('pog AND role:vip', msg)).toBe(false)
  })

  it('OR succeeds if either', () => {
    const msg = makeMsg({ text: 'pog' })
    expect(evalSrc('pog OR sub', msg)).toBe(true)
    expect(evalSrc('nope OR sub', msg)).toBe(false)
  })

  it('NOT negates', () => {
    expect(evalSrc('!pog', makeMsg({ text: 'xyz' }))).toBe(true)
    expect(evalSrc('!pog', makeMsg({ text: 'pog' }))).toBe(false)
  })

  it('parenthesized precedence: (a OR b) AND c', () => {
    // (sub OR role:vip) AND kw:"pog"
    const src = '(sub OR role:vip) AND kw:"pog"'
    const subPog = makeMsg({ text: 'pog champ', badges: [badge('subscriber')] })
    expect(evalSrc(src, subPog)).toBe(true)
    const modPog = makeMsg({ text: 'pog champ', badges: [badge('moderator')] })
    expect(evalSrc(src, modPog)).toBe(false) // mod, no sub/vip
    const subNoPog = makeMsg({ text: 'meh', badges: [badge('subscriber')] })
    expect(evalSrc(src, subNoPog)).toBe(false)
  })

  it('risk:elevated matches when ctx.riskBandFor returns elevated', () => {
    const ctx: EvalContext = { isDuringSpike: () => false, riskBandFor: () => 'elevated' }
    expect(evalSrc('risk:elevated', makeMsg({}), ctx)).toBe(true)
  })

  it('risk:elevated does not match when ctx.riskBandFor returns calm', () => {
    const ctx: EvalContext = { isDuringSpike: () => false, riskBandFor: () => 'calm' }
    expect(evalSrc('risk:elevated', makeMsg({}), ctx)).toBe(false)
  })

  it('risk:calm AND kw:"pog" composes correctly', () => {
    const ctx: EvalContext = { isDuringSpike: () => false, riskBandFor: () => 'calm' }
    expect(evalSrc('risk:calm AND kw:"pog"', makeMsg({ text: 'pog champ' }), ctx)).toBe(true)
    expect(evalSrc('risk:calm AND kw:"pog"', makeMsg({ text: 'no champ' }), ctx)).toBe(false)
    const elevated: EvalContext = { isDuringSpike: () => false, riskBandFor: () => 'elevated' }
    expect(evalSrc('risk:calm AND kw:"pog"', makeMsg({ text: 'pog champ' }), elevated)).toBe(false)
  })

  it('risk:critical without ctx.riskBandFor throws reserved error', () => {
    expect(() => evalSrc('risk:critical', makeMsg({}), baseCtx)).toThrow(/risk_token_reserved_for_phase_9/)
  })
})
