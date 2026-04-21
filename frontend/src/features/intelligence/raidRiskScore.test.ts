import { describe, expect, it } from 'vitest'
import type { AnomalySignals } from '../../types/twitch'
import { bandFor, computeRaidRiskScore, DEFAULT_WEIGHTS } from './raidRiskScore'

const signals = (partial: Partial<AnomalySignals>): AnomalySignals => ({
  similarityBurst: 0,
  newChatterInflux: 0,
  lexicalDiversityDrop: 0,
  emoteVsTextRatio: 0,
  ...partial,
})

describe('computeRaidRiskScore', () => {
  it('all-zero signals → 0', () => {
    expect(computeRaidRiskScore(signals({}))).toBe(0)
  })
  it('all-one signals → 100', () => {
    expect(
      computeRaidRiskScore({
        similarityBurst: 1,
        newChatterInflux: 1,
        lexicalDiversityDrop: 1,
        emoteVsTextRatio: 1,
      }),
    ).toBe(100)
  })
  it('weighted sum matches default formula', () => {
    const s = {
      similarityBurst: 0.8,
      newChatterInflux: 0.4,
      lexicalDiversityDrop: 0.2,
      emoteVsTextRatio: 0.6,
    }
    const expected = Math.round((0.35 * 0.8 + 0.25 * 0.4 + 0.2 * 0.2 + 0.2 * 0.6) * 100)
    expect(computeRaidRiskScore(s)).toBe(expected)
  })
  it('custom weights override defaults', () => {
    const s = signals({ similarityBurst: 1 })
    expect(computeRaidRiskScore(s, { ...DEFAULT_WEIGHTS, similarityBurst: 0 })).toBe(0)
  })
})

describe('bandFor', () => {
  it('score < 20 → calm', () => {
    expect(bandFor(0)).toBe('calm')
    expect(bandFor(19)).toBe('calm')
  })
  it('score 20 → elevated (boundary)', () => {
    expect(bandFor(20)).toBe('elevated')
  })
  it('score 50 → elevated (boundary)', () => {
    expect(bandFor(50)).toBe('elevated')
  })
  it('score 51 → high', () => {
    expect(bandFor(51)).toBe('high')
  })
  it('score 80 → high (boundary)', () => {
    expect(bandFor(80)).toBe('high')
  })
  it('score 81 → critical', () => {
    expect(bandFor(81)).toBe('critical')
  })
  it('NaN → calm (defensive)', () => {
    expect(bandFor(Number.NaN)).toBe('calm')
  })
  it('Infinity → critical', () => {
    expect(bandFor(Number.POSITIVE_INFINITY)).toBe('critical')
  })
})
