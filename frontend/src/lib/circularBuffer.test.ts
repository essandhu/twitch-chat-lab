import { describe, expect, it } from 'vitest'
import { CircularBuffer } from './circularBuffer'

describe('CircularBuffer', () => {
  it('push below capacity stores items in order; items() oldest-to-newest', () => {
    const buf = new CircularBuffer<string>({ capacity: 3 })
    buf.push('a', 1)
    buf.push('b', 2)
    buf.push('c', 3)
    expect(buf.size).toBe(3)
    expect(buf.items()).toEqual(['a', 'b', 'c'])
  })

  it('FIFO evicts oldest when push would exceed capacity', () => {
    const buf = new CircularBuffer<string>({ capacity: 3 })
    buf.push('a', 1)
    buf.push('b', 2)
    buf.push('c', 3)
    buf.push('d', 4)
    expect(buf.size).toBe(3)
    expect(buf.items()).toEqual(['b', 'c', 'd'])
  })

  it('size never exceeds capacity across many pushes', () => {
    const buf = new CircularBuffer<number>({ capacity: 5 })
    for (let i = 0; i < 1000; i += 1) buf.push(i, i)
    expect(buf.size).toBe(5)
    expect(buf.items()).toEqual([995, 996, 997, 998, 999])
  })

  it('maxAgeMs evicts items whose t + maxAgeMs < now (where now is the pushed item t)', () => {
    const buf = new CircularBuffer<string>({ capacity: 100, maxAgeMs: 1000 })
    buf.push('old', 0)
    buf.push('mid', 500)
    buf.push('fresh', 1500)
    expect(buf.items()).toEqual(['mid', 'fresh'])
  })

  it('combines capacity and age eviction (capacity takes first, age next)', () => {
    const buf = new CircularBuffer<string>({ capacity: 3, maxAgeMs: 1000 })
    buf.push('a', 0)
    buf.push('b', 500)
    buf.push('c', 1000)
    buf.push('d', 1500)
    expect(buf.items()).toEqual(['b', 'c', 'd'])
    buf.push('e', 3000)
    expect(buf.items()).toEqual(['e'])
  })

  it('clear() resets size to 0', () => {
    const buf = new CircularBuffer<string>({ capacity: 3 })
    buf.push('a', 1)
    buf.push('b', 2)
    buf.clear()
    expect(buf.size).toBe(0)
    expect(buf.items()).toEqual([])
  })

  it('clear() followed by push works normally', () => {
    const buf = new CircularBuffer<string>({ capacity: 3 })
    buf.push('a', 1)
    buf.clear()
    buf.push('x', 10)
    buf.push('y', 20)
    expect(buf.items()).toEqual(['x', 'y'])
  })

  it('push does not throw on duplicate t', () => {
    const buf = new CircularBuffer<string>({ capacity: 3 })
    expect(() => {
      buf.push('a', 100)
      buf.push('b', 100)
      buf.push('c', 100)
    }).not.toThrow()
    expect(buf.items()).toEqual(['a', 'b', 'c'])
  })

  it('items() returns a copy; mutating the result does not affect the buffer', () => {
    const buf = new CircularBuffer<string>({ capacity: 3 })
    buf.push('a', 1)
    const snapshot = buf.items()
    snapshot.push('x')
    expect(buf.items()).toEqual(['a'])
  })

  it('replay-pure: no ambient Date.now or Math.random in eviction — same input sequence produces identical items twice', () => {
    const run = () => {
      const buf = new CircularBuffer<number>({ capacity: 5, maxAgeMs: 500 })
      for (let i = 0; i < 20; i += 1) buf.push(i, i * 100)
      return buf.items()
    }
    expect(run()).toEqual(run())
  })

  it('single-item push works at capacity 1', () => {
    const buf = new CircularBuffer<string>({ capacity: 1 })
    buf.push('a', 1)
    buf.push('b', 2)
    expect(buf.items()).toEqual(['b'])
    expect(buf.size).toBe(1)
  })

  it('maxAgeMs of 0 means only the most recent t survives', () => {
    const buf = new CircularBuffer<string>({ capacity: 10, maxAgeMs: 0 })
    buf.push('a', 0)
    buf.push('b', 1)
    expect(buf.items()).toEqual(['b'])
  })

  it('push accepts any T (generic) — objects are preserved by reference', () => {
    interface Frame {
      id: number
    }
    const buf = new CircularBuffer<Frame>({ capacity: 2 })
    const f1 = { id: 1 }
    const f2 = { id: 2 }
    buf.push(f1, 1)
    buf.push(f2, 2)
    const items = buf.items()
    expect(items[0]).toBe(f1)
    expect(items[1]).toBe(f2)
  })
})
