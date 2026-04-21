import { beforeEach, describe, expect, it } from 'vitest'
import type { FilterState } from '../types/twitch'
import { DEFAULT_FILTER_STATE, pairKeyFor, useMultiStreamStore } from './multiStreamStore'

const seed = (login: string, displayName: string = login): void => {
  useMultiStreamStore.getState().addStream({
    login,
    displayName,
    broadcasterId: `b_${login}`,
  })
}

const setSeries = (login: string, samples: number[]): void => {
  const state = useMultiStreamStore.getState()
  const slice = state.streams[login]
  if (!slice) throw new Error(`no slice for ${login}`)
  const now = Date.now()
  const nextPoints = samples.map((msgPerSec, idx) => ({
    timestamp: now - (samples.length - idx) * 1000,
    msgPerSec,
  }))
  useMultiStreamStore.setState({
    streams: {
      ...state.streams,
      [login]: { ...slice, dataPoints: nextPoints },
    },
  })
}

describe('multiStreamStore filterState', () => {
  beforeEach(() => {
    useMultiStreamStore.getState().reset()
  })

  it('addStream seeds default filterState', () => {
    seed('alice')
    expect(useMultiStreamStore.getState().filterState.alice).toEqual(DEFAULT_FILTER_STATE)
  })

  it('setStreamFilter writes only to target login', () => {
    seed('alice')
    seed('bob')
    useMultiStreamStore.getState().setStreamFilter('alice', { firstTimeOnly: true })
    const state = useMultiStreamStore.getState()
    expect(state.filterState.alice?.firstTimeOnly).toBe(true)
    expect(state.filterState.bob?.firstTimeOnly).toBe(false)
  })

  it('setStreamFilter merges partial updates over existing state', () => {
    seed('alice')
    useMultiStreamStore.getState().setStreamFilter('alice', { keyword: 'pog' })
    useMultiStreamStore.getState().setStreamFilter('alice', { subscribersOnly: true })
    const after = useMultiStreamStore.getState().filterState.alice
    expect(after).toMatchObject({ keyword: 'pog', subscribersOnly: true, firstTimeOnly: false })
  })

  it('setStreamFilter seeds a default entry for an unseeded login', () => {
    useMultiStreamStore.getState().setStreamFilter('ghost', { keyword: 'x' })
    const entry = useMultiStreamStore.getState().filterState.ghost
    expect(entry).toBeDefined()
    expect(entry?.keyword).toBe('x')
  })

  it('applyFilterToAllStreams fans out to every login in order (replace, not merge)', () => {
    seed('alice')
    seed('bob')
    seed('carol')
    useMultiStreamStore.getState().setStreamFilter('alice', { firstTimeOnly: true, keyword: 'keep' })
    const next: FilterState = {
      firstTimeOnly: false,
      subscribersOnly: true,
      keyword: '',
      hypeModeOnly: false,
      query: 'role:sub',
      queryError: null,
    }
    useMultiStreamStore.getState().applyFilterToAllStreams(next)
    const state = useMultiStreamStore.getState()
    for (const login of ['alice', 'bob', 'carol']) {
      expect(state.filterState[login]).toEqual(next)
    }
  })

  it('removeStream drops filterState and correlation entries for that login', () => {
    seed('alice')
    seed('bob')
    seed('carol')
    setSeries('alice', Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 0)))
    setSeries('bob', Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 2 : 0)))
    setSeries('carol', Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 3 : 0)))
    useMultiStreamStore.getState().tickCorrelation(Date.now())
    const before = Object.keys(useMultiStreamStore.getState().correlation)
    expect(before).toContain(pairKeyFor('alice', 'bob'))
    expect(before).toContain(pairKeyFor('alice', 'carol'))
    useMultiStreamStore.getState().removeStream('alice')
    const state = useMultiStreamStore.getState()
    expect(state.filterState.alice).toBeUndefined()
    expect(Object.keys(state.correlation)).toEqual([pairKeyFor('bob', 'carol')])
  })

  it('tickCorrelation writes entry per active pair with sorted pairKey', () => {
    seed('bob')
    seed('alice')
    setSeries('alice', Array.from({ length: 30 }, (_, i) => Math.sin(i)))
    setSeries('bob', Array.from({ length: 30 }, (_, i) => Math.sin(i)))
    useMultiStreamStore.getState().tickCorrelation(Date.now())
    const entry = useMultiStreamStore.getState().correlation[pairKeyFor('alice', 'bob')]
    expect(entry).toBeDefined()
    expect(entry!.coefficient).toBeCloseTo(1, 3)
  })

  it('tickCorrelation skips pairs with < 10 samples', () => {
    seed('alice')
    seed('bob')
    setSeries('alice', [1, 2, 3, 4]) // < 10
    setSeries('bob', Array.from({ length: 30 }, (_, i) => i))
    useMultiStreamStore.getState().tickCorrelation(Date.now())
    expect(useMultiStreamStore.getState().correlation[pairKeyFor('alice', 'bob')]).toBeUndefined()
  })

  it('reset() clears filterState and correlation', () => {
    seed('alice')
    seed('bob')
    setSeries('alice', Array.from({ length: 30 }, (_, i) => i))
    setSeries('bob', Array.from({ length: 30 }, (_, i) => i))
    useMultiStreamStore.getState().tickCorrelation(Date.now())
    useMultiStreamStore.getState().reset()
    const state = useMultiStreamStore.getState()
    expect(state.filterState).toEqual({})
    expect(state.correlation).toEqual({})
    expect(state.streams).toEqual({})
    expect(state.order).toEqual([])
  })

  it('pairKeyFor is commutative via alphabetical sort', () => {
    expect(pairKeyFor('bob', 'alice')).toBe('alice|bob')
    expect(pairKeyFor('alice', 'bob')).toBe('alice|bob')
  })
})
