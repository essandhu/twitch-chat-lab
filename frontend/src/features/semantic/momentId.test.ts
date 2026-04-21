import { describe, expect, it } from 'vitest'
import { hashMomentId } from './detectMoments'

/**
 * This suite is a Phase 11 replay-equivalence prerequisite. Moment IDs must be
 * deterministic: identical inputs MUST produce identical outputs across processes,
 * builds, and session replays so serialized moment sets can be cross-referenced
 * without reconstruction ambiguity.
 */
describe('hashMomentId determinism', () => {
  it('produces identical ids for identical inputs across 100 runs', () => {
    const d = new Date('2026-04-20T10:00:00.000Z')
    const first = hashMomentId('spike', d, 'm1')
    for (let i = 0; i < 100; i++) {
      expect(hashMomentId('spike', d, 'm1')).toBe(first)
    }
  })

  it('differs when startedAt differs by 1 ms', () => {
    const a = hashMomentId('spike', new Date(1000), 'm1')
    const b = hashMomentId('spike', new Date(1001), 'm1')
    expect(a).not.toBe(b)
  })

  it('produces a stable hash when relatedMessageIds is empty', () => {
    const a = hashMomentId('spike', new Date(1000), '')
    const b = hashMomentId('spike', new Date(1000), '')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]+$/)
  })

  it('differs across kinds with identical start times', () => {
    const kinds: Array<'spike' | 'emote-storm' | 'qa-cluster' | 'raid' | 'semantic-cluster'> = [
      'spike', 'emote-storm', 'qa-cluster', 'raid', 'semantic-cluster',
    ]
    const ids = kinds.map((k) => hashMomentId(k, new Date(1000), 'm1'))
    const unique = new Set(ids)
    expect(unique.size).toBe(kinds.length)
  })

  it('differs when firstRelatedMessageId differs', () => {
    const a = hashMomentId('raid', new Date(1000), 'm1')
    const b = hashMomentId('raid', new Date(1000), 'm2')
    expect(a).not.toBe(b)
  })

  it('returns a lowercase hex string', () => {
    const id = hashMomentId('spike', new Date(1000), 'm1')
    expect(id).toMatch(/^[0-9a-f]+$/)
  })
})
