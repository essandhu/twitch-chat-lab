import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessageFragment } from '../../types/twitch'
import { extractBitsContext, extractCallouts, extractQuestions } from './SignalExtractor'

const makeMsg = (opts: {
  text?: string
  fragments?: MessageFragment[]
  cheer?: { bits: number }
  id?: string
}): ChatMessage => {
  const text = opts.text ?? ''
  return {
    id: opts.id ?? 'm1',
    userId: 'u1',
    userLogin: 'u1',
    displayName: 'U1',
    color: '#fff',
    badges: [],
    fragments: opts.fragments ?? [{ type: 'text', text }],
    text,
    isFirstInSession: false,
    isHighlighted: false,
    timestamp: new Date(0),
    cheer: opts.cheer,
    messageType: 'text',
  }
}

describe('extractQuestions', () => {
  it('ends-with-? matches', () => {
    expect(extractQuestions(makeMsg({ text: 'is this working??' }))?.kind).toBe('question')
  })
  it('WH-word start matches (case insensitive)', () => {
    expect(extractQuestions(makeMsg({ text: 'WHY is this happening today' }))?.kind).toBe('question')
    expect(extractQuestions(makeMsg({ text: 'how do we fix that' }))?.kind).toBe('question')
  })
  it('length guard rejects "wat?"', () => {
    expect(extractQuestions(makeMsg({ text: 'wat?' }))).toBeNull()
  })
  it('emote-only majority rejects', () => {
    const msg = makeMsg({
      text: 'KEKW KEKW KEKW Pog Pog ?',
      fragments: [
        { type: 'emote', text: 'KEKW', emote: { id: '1' } },
        { type: 'emote', text: 'KEKW', emote: { id: '1' } },
        { type: 'emote', text: 'KEKW', emote: { id: '1' } },
        { type: 'emote', text: 'Pog', emote: { id: '2' } },
        { type: 'emote', text: 'Pog', emote: { id: '2' } },
        { type: 'text', text: '?' },
      ],
    })
    expect(extractQuestions(msg)).toBeNull()
  })
  it('non-question text returns null', () => {
    expect(extractQuestions(makeMsg({ text: 'regular chat message here' }))).toBeNull()
  })
  it('ref carries messageId + timestamp', () => {
    const ref = extractQuestions(makeMsg({ text: 'what time is it', id: 'msgX' }))
    expect(ref?.messageId).toBe('msgX')
    expect(typeof ref?.timestamp).toBe('number')
  })
})

describe('extractCallouts', () => {
  it('@login plain match', () => {
    expect(extractCallouts(makeMsg({ text: 'hey @streamer how are you' }), 'streamer', 'Streamer')?.kind).toBe('callout')
  })
  it('@LoginMixedCase matches case-insensitive', () => {
    expect(extractCallouts(makeMsg({ text: 'yo @SOMEONECOOL !' }), 'someonecool', 'SomeoneCool')?.kind).toBe('callout')
  })
  it('@displayName with unicode/digits matches', () => {
    expect(
      extractCallouts(makeMsg({ text: 'thanks @Omega_42!' }), 'omega42', 'Omega_42')?.kind,
    ).toBe('callout')
  })
  it('metacharacters in display name are escaped', () => {
    expect(extractCallouts(makeMsg({ text: 'hi @user.name you rock' }), 'user_name', 'user.name')?.kind).toBe('callout')
    expect(extractCallouts(makeMsg({ text: 'hi @userXname' }), 'user_name', 'user.name')).toBeNull()
  })
  it('no @ → null', () => {
    expect(extractCallouts(makeMsg({ text: 'just talking about streamer here' }), 'streamer', 'Streamer')).toBeNull()
  })
})

describe('extractBitsContext', () => {
  it('with cheer → ref', () => {
    const msg = makeMsg({ text: 'cheer100 nice', cheer: { bits: 100 }, id: 'b1' })
    const ref = extractBitsContext(msg)
    expect(ref?.kind).toBe('bitsContext')
    expect(ref?.messageId).toBe('b1')
  })
  it('without cheer → null', () => {
    expect(extractBitsContext(makeMsg({ text: 'no cheer here' }))).toBeNull()
  })
})
