import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addPreset, deletePreset, readPresets, writePresets } from './filterPresetsStorage'

const KEY = 'tcl.filter.presets'

describe('filterPresetsStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns empty when nothing stored', () => {
    expect(readPresets()).toEqual([])
  })

  it('returns empty for malformed JSON', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readPresets()).toEqual([])
  })

  it('returns empty when payload is not an array', () => {
    localStorage.setItem(KEY, '{"foo": "bar"}')
    expect(readPresets()).toEqual([])
  })

  it('round-trips write + read', () => {
    const presets = [
      { name: 'hype-subs', query: 'sub AND hype' },
      { name: 'raids', query: 'kw:"raid"' },
    ]
    writePresets(presets)
    expect(readPresets()).toEqual(presets)
  })

  it('filters out malformed entries on read', () => {
    localStorage.setItem(KEY, JSON.stringify([{ name: 'ok', query: 'x' }, { bad: true }]))
    expect(readPresets()).toEqual([{ name: 'ok', query: 'x' }])
  })

  it('addPreset appends when name is new', () => {
    writePresets([{ name: 'a', query: 'x' }])
    const next = addPreset('b', 'y')
    expect(next).toEqual([
      { name: 'a', query: 'x' },
      { name: 'b', query: 'y' },
    ])
  })

  it('addPreset replaces when name exists', () => {
    writePresets([{ name: 'a', query: 'old' }])
    const next = addPreset('a', 'new')
    expect(next).toEqual([{ name: 'a', query: 'new' }])
  })

  it('deletePreset removes by name', () => {
    writePresets([
      { name: 'a', query: '1' },
      { name: 'b', query: '2' },
    ])
    expect(deletePreset('a')).toEqual([{ name: 'b', query: '2' }])
  })
})
