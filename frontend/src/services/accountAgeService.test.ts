import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — fake-indexeddb's package.json exports omit the subpath typings
import FDBFactory from 'fake-indexeddb/lib/FDBFactory'
import type { HelixUser } from '../types/twitch'
import { AccountAgeService } from './accountAgeService'
import * as cache from './accountAgeCache'
import { HelixError, UnauthorizedError } from './TwitchHelixClient'

const makeUser = (id: string, createdAt: string): HelixUser => ({
  id,
  login: `u${id}`,
  display_name: `U${id}`,
  profile_image_url: '',
  created_at: createdAt,
})

interface FakeHelix {
  getUsersByIds: ReturnType<typeof vi.fn>
}

// Wait long enough for cache reads to resolve AND the 250ms flush timer to fire.
const waitForFlush = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('accountAgeService', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new FDBFactory()
    cache._resetForTest()
  })

  it('batches concurrent misses into a single Helix call', async () => {
    const helix: FakeHelix = {
      getUsersByIds: vi.fn(async (ids: string[]) => ids.map((id) => makeUser(id, '2020-01-01T00:00:00Z'))),
    }
    const service = new AccountAgeService({ helix: helix as never })
    const promises = ['1', '2', '3', '4', '5'].map((id) => service.getAccountAge(id))
    await waitForFlush()
    const results = await Promise.all(promises)
    expect(helix.getUsersByIds).toHaveBeenCalledTimes(1)
    expect(helix.getUsersByIds.mock.calls[0][0]).toEqual(['1', '2', '3', '4', '5'])
    expect(results.every((r) => r.source === 'helix')).toBe(true)
  })

  it('chunks 250 concurrent misses into three Helix calls (100/100/50)', async () => {
    const helix: FakeHelix = {
      getUsersByIds: vi.fn(async (ids: string[]) => ids.map((id) => makeUser(id, '2020-01-01T00:00:00Z'))),
    }
    const service = new AccountAgeService({ helix: helix as never })
    const ids = Array.from({ length: 250 }, (_, i) => String(i + 1))
    const promises = ids.map((id) => service.getAccountAge(id))
    await waitForFlush(600)
    await Promise.all(promises)
    expect(helix.getUsersByIds).toHaveBeenCalledTimes(3)
    const sizes = helix.getUsersByIds.mock.calls.map((c) => (c[0] as string[]).length).sort((a, b) => b - a)
    expect(sizes).toEqual([100, 100, 50])
  })

  it('cache hit returns without HTTP call', async () => {
    await cache.writeMany([{ userId: '42', createdAt: '2019-06-01T00:00:00Z', fetchedAt: 0 }])
    const helix: FakeHelix = { getUsersByIds: vi.fn() }
    const service = new AccountAgeService({ helix: helix as never })
    const record = await service.getAccountAge('42')
    expect(record.source).toBe('helix')
    expect(record.createdAt).toBe('2019-06-01T00:00:00Z')
    expect(helix.getUsersByIds).not.toHaveBeenCalled()
  })

  it('401 UnauthorizedError → immediate heuristic fallback', async () => {
    const helix: FakeHelix = {
      getUsersByIds: vi.fn(async () => {
        throw new UnauthorizedError()
      }),
    }
    const service = new AccountAgeService({ helix: helix as never })
    const p = service.getAccountAge('100')
    await waitForFlush()
    const record = await p
    expect(record.source).toBe('approximate')
  })

  it('429 retries with backoff then succeeds', async () => {
    let attempts = 0
    const helix: FakeHelix = {
      getUsersByIds: vi.fn(async (ids: string[]) => {
        attempts++
        if (attempts === 1) throw new HelixError(429, 'too many')
        return ids.map((id) => makeUser(id, '2018-03-01T00:00:00Z'))
      }),
    }
    const service = new AccountAgeService({ helix: helix as never })
    const p = service.getAccountAge('7')
    await waitForFlush(1500)
    const rec = await p
    expect(helix.getUsersByIds).toHaveBeenCalledTimes(2)
    expect(rec.source).toBe('helix')
  })

  it('3 consecutive 500s circuit-break to heuristic', async () => {
    const helix: FakeHelix = {
      getUsersByIds: vi.fn(async () => {
        throw new HelixError(500, 'oops')
      }),
    }
    const service = new AccountAgeService({ helix: helix as never, now: () => 1_000 })
    const p1 = service.getAccountAge('1')
    await waitForFlush(5000)
    expect((await p1).source).toBe('approximate')
    const p2 = service.getAccountAge('2')
    await waitForFlush(5000)
    expect((await p2).source).toBe('approximate')
    const p3 = service.getAccountAge('3')
    await waitForFlush(5000)
    expect((await p3).source).toBe('approximate')
    const callsBefore = helix.getUsersByIds.mock.calls.length
    const p4 = service.getAccountAge('4')
    await waitForFlush()
    await p4
    expect(helix.getUsersByIds.mock.calls.length).toBe(callsBefore)
  }, 30_000)

  it('primeAccountAge bulk-warms cache without invoking the queue', async () => {
    const helix: FakeHelix = {
      getUsersByIds: vi.fn(async (ids: string[]) => ids.map((id) => makeUser(id, '2017-09-01T00:00:00Z'))),
    }
    const service = new AccountAgeService({ helix: helix as never })
    await service.primeAccountAge(['10', '11', '12'])
    const helix2: FakeHelix = { getUsersByIds: vi.fn() }
    const service2 = new AccountAgeService({ helix: helix2 as never })
    const rec = await service2.getAccountAge('10')
    expect(rec.source).toBe('helix')
    expect(helix2.getUsersByIds).not.toHaveBeenCalled()
  })

  it('non-numeric userId → heuristic (unknown bucket)', async () => {
    const helix: FakeHelix = { getUsersByIds: vi.fn() }
    const service = new AccountAgeService({ helix: helix as never })
    const rec = await service.getAccountAge('notANumber')
    expect(rec.source).toBe('approximate')
    expect(rec.bucket).toBe('unknown')
    expect(helix.getUsersByIds).not.toHaveBeenCalled()
  })
})
