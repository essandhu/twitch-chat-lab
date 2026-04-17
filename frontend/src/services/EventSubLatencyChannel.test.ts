import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetForTests,
  readLatencySample,
  recordLatencySample,
} from './EventSubLatencyChannel'

describe('EventSubLatencyChannel', () => {
  beforeEach(() => {
    __resetForTests()
  })

  it('returns null before any sample is recorded', () => {
    expect(readLatencySample()).toBeNull()
  })

  it('records and returns the diff between now and the parsed timestamp', () => {
    const ts = new Date(800).toISOString()
    recordLatencySample(1000, ts)
    expect(readLatencySample()).toBe(200)
  })

  it('clamps negative diffs to zero', () => {
    const ts = new Date(900).toISOString()
    recordLatencySample(500, ts)
    expect(readLatencySample()).toBe(0)
  })

  it('silently ignores invalid timestamps and does not overwrite lastSample', () => {
    recordLatencySample(1000, new Date(800).toISOString())
    expect(readLatencySample()).toBe(200)

    // Invalid timestamp must not throw and must not overwrite the prior sample.
    expect(() => recordLatencySample(2000, 'not-a-date')).not.toThrow()
    expect(readLatencySample()).toBe(200)
  })

  it('silently ignores invalid timestamps when no prior sample exists', () => {
    expect(() => recordLatencySample(1000, 'not-a-date')).not.toThrow()
    expect(readLatencySample()).toBeNull()
  })

  it('reads are non-destructive — repeated reads return the same value', () => {
    recordLatencySample(1000, new Date(700).toISOString())
    expect(readLatencySample()).toBe(300)
    expect(readLatencySample()).toBe(300)
    expect(readLatencySample()).toBe(300)
  })

  it('overwrites with the most recent sample on subsequent records', () => {
    recordLatencySample(1000, new Date(800).toISOString())
    expect(readLatencySample()).toBe(200)
    recordLatencySample(2000, new Date(1500).toISOString())
    expect(readLatencySample()).toBe(500)
  })
})
