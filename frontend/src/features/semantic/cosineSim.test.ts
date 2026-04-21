import { describe, expect, it } from 'vitest'
import { centroid, cosineSim, topK } from './cosineSim'

const f32 = (values: number[]): Float32Array => Float32Array.from(values)

describe('cosineSim', () => {
  it('returns 1 for identical unit vectors', () => {
    const a = f32([1, 0, 0])
    expect(cosineSim(a, a)).toBeCloseTo(1, 6)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim(f32([1, 0, 0]), f32([0, 1, 0]))).toBeCloseTo(0, 6)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSim(f32([1, 0, 0]), f32([-1, 0, 0]))).toBeCloseTo(-1, 6)
  })

  it('returns 0 when either vector has zero norm', () => {
    expect(cosineSim(f32([0, 0, 0]), f32([1, 0, 0]))).toBe(0)
    expect(cosineSim(f32([1, 0, 0]), f32([0, 0, 0]))).toBe(0)
  })

  it('returns 0 when vector lengths differ', () => {
    expect(cosineSim(f32([1, 0]), f32([1, 0, 0]))).toBe(0)
  })

  it('computes cosine correctly for non-unit vectors', () => {
    const a = f32([3, 4])
    const b = f32([4, 3])
    // dot = 24; ||a|| = 5; ||b|| = 5; cos = 24/25 = 0.96
    expect(cosineSim(a, b)).toBeCloseTo(0.96, 6)
  })
})

describe('topK', () => {
  it('returns an empty array when entries are empty', () => {
    expect(topK(f32([1, 0, 0]), [], 5)).toEqual([])
  })

  it('orders top-3 results descending by score', () => {
    const query = f32([1, 0, 0])
    const entries = [
      { messageId: 'a', vector: f32([0, 1, 0]) }, // cos ~ 0
      { messageId: 'b', vector: f32([1, 0, 0]) }, // cos ~ 1
      { messageId: 'c', vector: f32([0.7, 0.7, 0]) }, // ~0.7
      { messageId: 'd', vector: f32([-1, 0, 0]) }, // -1
    ]
    const out = topK(query, entries, 3)
    expect(out).toHaveLength(3)
    expect(out[0].messageId).toBe('b')
    expect(out[1].messageId).toBe('c')
    expect(out[2].messageId).toBe('a')
  })

  it('caps results to k even when more entries exist', () => {
    const query = f32([1, 0, 0])
    const entries = Array.from({ length: 10 }, (_, i) => ({
      messageId: `m${i}`,
      vector: f32([1, i * 0.1, 0]),
    }))
    expect(topK(query, entries, 4)).toHaveLength(4)
  })
})

describe('centroid', () => {
  it('returns a single-vector centroid equal to the input', () => {
    const v = f32([1, 2, 3])
    const c = centroid([v])
    expect(Array.from(c)).toEqual([1, 2, 3])
  })

  it('returns component-wise mean of two vectors', () => {
    const out = centroid([f32([1, 2, 3]), f32([3, 4, 5])])
    expect(Array.from(out)).toEqual([2, 3, 4])
  })

  it('returns a zero vector for empty input', () => {
    const out = centroid([])
    expect(out.length).toBe(0)
  })
})
