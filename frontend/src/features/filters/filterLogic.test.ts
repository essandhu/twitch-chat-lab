import { describe, expect, it } from 'vitest'
import type { Badge, ChatMessage, FilterState } from '../../types/twitch'
import { applyFilters, countActiveFilters } from './filterLogic'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const base: ChatMessage = {
    id: 'm1',
    userId: 'u1',
    userLogin: 'user1',
    displayName: 'User1',
    color: '',
    badges: [],
    fragments: [{ type: 'text', text: 'hello world' }],
    text: 'hello world',
    isFirstInSession: false,
    isHighlighted: false,
    timestamp: new Date(0),
  }
  return { ...base, ...overrides }
}

const subscriberBadge: Badge = { setId: 'subscriber', id: '0', info: '1' }
const moderatorBadge: Badge = { setId: 'moderator', id: '1', info: '' }

const inactiveState: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

const neverSpike = (_ts: number): boolean => false
const alwaysSpike = (_ts: number): boolean => true

// -----------------------------------------------------------------------------
// applyFilters — individual filters
// -----------------------------------------------------------------------------

describe('applyFilters — firstTimeOnly', () => {
  it('passes only messages where isFirstInSession === true', () => {
    const messages = [
      makeMessage({ id: 'a', isFirstInSession: true }),
      makeMessage({ id: 'b', isFirstInSession: false }),
      makeMessage({ id: 'c', isFirstInSession: true }),
    ]
    const result = applyFilters(messages, { ...inactiveState, firstTimeOnly: true }, neverSpike)
    expect(result.map((m) => m.id)).toEqual(['a', 'c'])
  })
})

describe('applyFilters — subscribersOnly', () => {
  it('passes only messages with a subscriber badge (setId === "subscriber")', () => {
    const messages = [
      makeMessage({ id: 'a', badges: [subscriberBadge] }),
      makeMessage({ id: 'b', badges: [] }),
      makeMessage({ id: 'c', badges: [moderatorBadge] }),
      makeMessage({ id: 'd', badges: [moderatorBadge, subscriberBadge] }),
    ]
    const result = applyFilters(messages, { ...inactiveState, subscribersOnly: true }, neverSpike)
    expect(result.map((m) => m.id)).toEqual(['a', 'd'])
  })
})

describe('applyFilters — keyword', () => {
  it('is case-insensitive over message.text', () => {
    const messages = [
      makeMessage({ id: 'a', text: 'Hello World' }),
      makeMessage({ id: 'b', text: 'goodbye' }),
      makeMessage({ id: 'c', text: 'HELLO there' }),
    ]
    const result = applyFilters(messages, { ...inactiveState, keyword: 'hello' }, neverSpike)
    expect(result.map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('matches regardless of keyword casing', () => {
    const messages = [
      makeMessage({ id: 'a', text: 'foo bar' }),
      makeMessage({ id: 'b', text: 'baz' }),
    ]
    const result = applyFilters(messages, { ...inactiveState, keyword: 'FOO' }, neverSpike)
    expect(result.map((m) => m.id)).toEqual(['a'])
  })

  it('empty keyword is inactive — all messages pass', () => {
    const messages = [
      makeMessage({ id: 'a', text: 'anything' }),
      makeMessage({ id: 'b', text: 'else' }),
    ]
    const result = applyFilters(messages, { ...inactiveState, keyword: '' }, neverSpike)
    expect(result.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('applyFilters — hypeModeOnly', () => {
  it('uses the injected isDuringSpike stub against each timestamp', () => {
    const messages = [
      makeMessage({ id: 'a', timestamp: new Date(1000) }),
      makeMessage({ id: 'b', timestamp: new Date(2000) }),
      makeMessage({ id: 'c', timestamp: new Date(3000) }),
    ]
    const isDuringSpike = (ts: number): boolean => ts === 2000
    const result = applyFilters(messages, { ...inactiveState, hypeModeOnly: true }, isDuringSpike)
    expect(result.map((m) => m.id)).toEqual(['b'])
  })

  it('returns all messages when isDuringSpike always returns true', () => {
    const messages = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })]
    const result = applyFilters(messages, { ...inactiveState, hypeModeOnly: true }, alwaysSpike)
    expect(result.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('returns no messages when isDuringSpike always returns false', () => {
    const messages = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })]
    const result = applyFilters(messages, { ...inactiveState, hypeModeOnly: true }, neverSpike)
    expect(result).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// applyFilters — combinations
// -----------------------------------------------------------------------------

describe('applyFilters — combinations (AND composition)', () => {
  it('firstTimeOnly + keyword: only messages satisfying BOTH', () => {
    const messages = [
      makeMessage({ id: 'a', isFirstInSession: true, text: 'hello' }),
      makeMessage({ id: 'b', isFirstInSession: true, text: 'bye' }),
      makeMessage({ id: 'c', isFirstInSession: false, text: 'hello' }),
      makeMessage({ id: 'd', isFirstInSession: false, text: 'bye' }),
    ]
    const result = applyFilters(
      messages,
      { ...inactiveState, firstTimeOnly: true, keyword: 'hello' },
      neverSpike,
    )
    expect(result.map((m) => m.id)).toEqual(['a'])
  })

  it('all four filters active: only messages satisfying ALL four', () => {
    const messages = [
      // Passes all four
      makeMessage({
        id: 'all',
        isFirstInSession: true,
        badges: [subscriberBadge],
        text: 'hype hello',
        timestamp: new Date(500),
      }),
      // Fails firstTimeOnly
      makeMessage({
        id: 'noFirst',
        isFirstInSession: false,
        badges: [subscriberBadge],
        text: 'hello',
        timestamp: new Date(500),
      }),
      // Fails subscribersOnly
      makeMessage({
        id: 'noSub',
        isFirstInSession: true,
        badges: [],
        text: 'hello',
        timestamp: new Date(500),
      }),
      // Fails keyword
      makeMessage({
        id: 'noKeyword',
        isFirstInSession: true,
        badges: [subscriberBadge],
        text: 'bye',
        timestamp: new Date(500),
      }),
      // Fails hypeModeOnly
      makeMessage({
        id: 'noHype',
        isFirstInSession: true,
        badges: [subscriberBadge],
        text: 'hello',
        timestamp: new Date(9999),
      }),
    ]
    const isDuringSpike = (ts: number): boolean => ts === 500
    const state: FilterState = {
      firstTimeOnly: true,
      subscribersOnly: true,
      keyword: 'hello',
      hypeModeOnly: true,
    }
    const result = applyFilters(messages, state, isDuringSpike)
    expect(result.map((m) => m.id)).toEqual(['all'])
  })
})

// -----------------------------------------------------------------------------
// applyFilters — identity short-circuit
// -----------------------------------------------------------------------------

describe('applyFilters — no filters active', () => {
  it('returns the SAME array reference (identity preserved for memoization)', () => {
    const messages = [
      makeMessage({ id: 'a' }),
      makeMessage({ id: 'b' }),
      makeMessage({ id: 'c' }),
    ]
    const result = applyFilters(messages, inactiveState, neverSpike)
    expect(result).toBe(messages)
  })

  it('returns the same reference even when the array is empty', () => {
    const messages: ChatMessage[] = []
    const result = applyFilters(messages, inactiveState, neverSpike)
    expect(result).toBe(messages)
  })
})

// -----------------------------------------------------------------------------
// countActiveFilters
// -----------------------------------------------------------------------------

describe('countActiveFilters', () => {
  it('returns 0 when no filters are active', () => {
    expect(countActiveFilters(inactiveState)).toBe(0)
  })

  it('returns 1 when only firstTimeOnly is active', () => {
    expect(countActiveFilters({ ...inactiveState, firstTimeOnly: true })).toBe(1)
  })

  it('returns 1 when only subscribersOnly is active', () => {
    expect(countActiveFilters({ ...inactiveState, subscribersOnly: true })).toBe(1)
  })

  it('returns 1 when only keyword is a non-empty string', () => {
    expect(countActiveFilters({ ...inactiveState, keyword: 'x' })).toBe(1)
  })

  it('returns 0 when keyword is the empty string', () => {
    expect(countActiveFilters({ ...inactiveState, keyword: '' })).toBe(0)
  })

  it('returns 1 when only hypeModeOnly is active', () => {
    expect(countActiveFilters({ ...inactiveState, hypeModeOnly: true })).toBe(1)
  })

  it('returns 2 for two active filters', () => {
    expect(
      countActiveFilters({
        firstTimeOnly: true,
        subscribersOnly: false,
        keyword: 'abc',
        hypeModeOnly: false,
      }),
    ).toBe(2)
  })

  it('returns 3 for three active filters', () => {
    expect(
      countActiveFilters({
        firstTimeOnly: true,
        subscribersOnly: true,
        keyword: 'abc',
        hypeModeOnly: false,
      }),
    ).toBe(3)
  })

  it('returns 4 when all filters are active', () => {
    expect(
      countActiveFilters({
        firstTimeOnly: true,
        subscribersOnly: true,
        keyword: 'abc',
        hypeModeOnly: true,
      }),
    ).toBe(4)
  })
})
