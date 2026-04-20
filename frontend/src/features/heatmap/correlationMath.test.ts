import { describe, expect, it } from 'vitest'
import { laggedPearson, pearson } from './correlationMath'

describe('pearson', () => {
  it('returns 1 for perfectly correlated series', () => {
    const a = [1, 2, 3, 4, 5]
    const b = [10, 20, 30, 40, 50]
    expect(pearson(a, b)).toBeCloseTo(1, 4)
  })

  it('returns -1 for perfectly anti-correlated series', () => {
    const a = [1, 2, 3, 4, 5]
    const b = [50, 40, 30, 20, 10]
    expect(pearson(a, b)).toBeCloseTo(-1, 4)
  })

  it('returns 0 for orthogonal zero-mean series', () => {
    // Deterministic zero-correlation pair.
    const a = [1, -1, 1, -1]
    const b = [1, 1, -1, -1]
    expect(pearson(a, b)).toBeCloseTo(0, 6)
  })

  it('returns NaN when a series has zero variance', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN()
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNaN()
  })

  it('returns NaN when series lengths differ', () => {
    expect(pearson([1, 2, 3], [1, 2])).toBeNaN()
  })

  it('returns NaN for arrays shorter than 2', () => {
    expect(pearson([], [])).toBeNaN()
    expect(pearson([1], [1])).toBeNaN()
  })
})

describe('laggedPearson', () => {
  it('identical series yields bestLag=0, coefficient=1', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const r = laggedPearson(s, s, 3)
    expect(r.bestLagSeconds).toBe(0)
    expect(r.coefficient).toBeCloseTo(1, 4)
  })

  it('detects a +3 lag between shifted series', () => {
    // A has a distinctive spike pattern; B is that pattern shifted forward by 3 samples.
    const a = [1, 5, 9, 2, 8, 1, 7, 3, 6, 4, 5, 2]
    const b = [99, 88, 77, 1, 5, 9, 2, 8, 1, 7, 3, 6]
    const r = laggedPearson(a, b, 5)
    expect(r.bestLagSeconds).toBe(3)
    expect(r.coefficient).toBeCloseTo(1, 4)
  })

  it('detects a -5 lag with anti-correlation', () => {
    // B leads A by 5 samples; A is negated version of B shifted.
    const b = [1, 5, 9, 2, 8, 1, 7, 3, 6, 4, 5, 2]
    const a = [99, 88, 77, 44, 22, -1, -5, -9, -2, -8, -1, -7]
    const r = laggedPearson(a, b, 6)
    expect(r.bestLagSeconds).toBe(-5)
    expect(r.coefficient).toBeCloseTo(-1, 4)
  })

  it('tie-breaks toward lag closest to zero', () => {
    const flat = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const r = laggedPearson(flat, flat, 3)
    expect(r.bestLagSeconds).toBe(0)
  })

  it('perLag contains 2*maxLag+1 entries', () => {
    const s = Array.from({ length: 20 }, (_, i) => i + 1)
    const r = laggedPearson(s, s, 10)
    expect(r.perLag).toHaveLength(21)
    expect(r.perLag[0].lag).toBe(-10)
    expect(r.perLag[20].lag).toBe(10)
  })
})
