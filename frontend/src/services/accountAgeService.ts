import { logger } from '../lib/logger'
import { accountAgeBucket } from '../features/intelligence/signalMath'
import type { AccountAgeBucket, AccountAgeRecord } from '../types/twitch'
import * as cache from './accountAgeCache'
import type { TwitchHelixClient } from './TwitchHelixClient'
import { HelixError, UnauthorizedError } from './TwitchHelixClient'

const FLUSH_INTERVAL_MS = 250
const FLUSH_BATCH = 100
const HELIX_MAX_PER_CALL = 100
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 8_000
const MAX_ATTEMPTS = 3
const CIRCUIT_BREAK_MS = 60_000

const bucketFromCreatedAt = (iso: string): AccountAgeBucket => {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000
  if (days < 30) return 'new'
  if (days < 365) return 'recent'
  return 'established'
}

const heuristic = (userId: string): AccountAgeRecord => ({
  bucket: accountAgeBucket(userId),
  source: 'approximate',
})

export interface AccountAgeServiceDeps {
  helix: TwitchHelixClient
  now?: () => number
  setTimeoutImpl?: typeof setTimeout
}

interface PendingEntry {
  userId: string
  resolve: (rec: AccountAgeRecord) => void
}

export class AccountAgeService {
  private helix: TwitchHelixClient
  private now: () => number
  private setTimeoutImpl: typeof setTimeout
  private queue: PendingEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private inflight = new Map<string, Promise<AccountAgeRecord>>()
  private consecutiveFailures = 0
  private circuitOpenUntil = 0

  constructor(deps: AccountAgeServiceDeps) {
    this.helix = deps.helix
    this.now = deps.now ?? Date.now
    this.setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout
  }

  getAccountAge(userId: string): Promise<AccountAgeRecord> {
    const existing = this.inflight.get(userId)
    if (existing) return existing
    const p = this.lookup(userId)
    this.inflight.set(userId, p)
    p.finally(() => this.inflight.delete(userId))
    return p
  }

  async primeAccountAge(ids: string[]): Promise<void> {
    const unique = Array.from(new Set(ids)).filter((id) => /^\d+$/.test(id))
    if (unique.length === 0) return
    const cached = await cache.readMany(unique)
    const missing = unique.filter((id) => cached[id] == null)
    if (missing.length === 0) return
    for (let i = 0; i < missing.length; i += HELIX_MAX_PER_CALL) {
      const chunk = missing.slice(i, i + HELIX_MAX_PER_CALL)
      try {
        const users = await this.helix.getUsersByIds(chunk)
        const records = users.map((u) => ({ userId: u.id, createdAt: u.created_at, fetchedAt: this.now() }))
        await cache.writeMany(records)
      } catch (err) {
        logger.warn('accountAge.prime.error', { error: String(err) })
        return
      }
    }
  }

  private async lookup(userId: string): Promise<AccountAgeRecord> {
    if (!/^\d+$/.test(userId)) return heuristic(userId)
    const cached = await cache.readMany([userId])
    const iso = cached[userId]
    if (iso) return { bucket: bucketFromCreatedAt(iso), source: 'helix', createdAt: iso }
    if (this.now() < this.circuitOpenUntil) return heuristic(userId)
    return new Promise<AccountAgeRecord>((resolve) => {
      this.queue.push({ userId, resolve })
      if (this.queue.length >= FLUSH_BATCH) {
        this.cancelTimer()
        void this.flush()
      } else if (!this.flushTimer) {
        this.flushTimer = this.setTimeoutImpl(() => {
          this.flushTimer = null
          void this.flush()
        }, FLUSH_INTERVAL_MS)
      }
    })
  }

  private cancelTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private async flush(): Promise<void> {
    const batch = this.queue.splice(0, this.queue.length)
    if (batch.length === 0) return
    const idsSet = Array.from(new Set(batch.map((e) => e.userId)))
    for (let i = 0; i < idsSet.length; i += HELIX_MAX_PER_CALL) {
      const chunk = idsSet.slice(i, i + HELIX_MAX_PER_CALL)
      await this.fetchChunk(chunk, batch)
    }
  }

  private async fetchChunk(ids: string[], batch: PendingEntry[]): Promise<void> {
    let attempt = 0
    let delay = BACKOFF_BASE_MS
    while (attempt < MAX_ATTEMPTS) {
      attempt++
      try {
        const users = await this.helix.getUsersByIds(ids)
        this.consecutiveFailures = 0
        const byId = new Map<string, string>()
        for (const u of users) byId.set(u.id, u.created_at)
        const records = users.map((u) => ({ userId: u.id, createdAt: u.created_at, fetchedAt: this.now() }))
        await cache.writeMany(records)
        for (const entry of batch) {
          if (!ids.includes(entry.userId)) continue
          const iso = byId.get(entry.userId)
          if (iso) entry.resolve({ bucket: bucketFromCreatedAt(iso), source: 'helix', createdAt: iso })
          else entry.resolve(heuristic(entry.userId))
        }
        return
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          for (const entry of batch) if (ids.includes(entry.userId)) entry.resolve(heuristic(entry.userId))
          return
        }
        const status = err instanceof HelixError ? err.status : 0
        const retriable = status === 429 || (status >= 500 && status < 600)
        if (!retriable || attempt >= MAX_ATTEMPTS) {
          this.consecutiveFailures++
          if (this.consecutiveFailures >= MAX_ATTEMPTS) {
            this.circuitOpenUntil = this.now() + CIRCUIT_BREAK_MS
            logger.warn('accountAge.circuit_open', { until: this.circuitOpenUntil })
          }
          for (const entry of batch) if (ids.includes(entry.userId)) entry.resolve(heuristic(entry.userId))
          return
        }
        const jitter = delay * (0.8 + Math.random() * 0.4)
        await new Promise<void>((r) => this.setTimeoutImpl(r, jitter))
        delay = Math.min(delay * 2, BACKOFF_MAX_MS)
      }
    }
  }
}

let singleton: AccountAgeService | null = null

export const initAccountAgeService = (helix: TwitchHelixClient): AccountAgeService => {
  if (!singleton) singleton = new AccountAgeService({ helix })
  return singleton
}

export const getAccountAgeService = (): AccountAgeService | null => singleton

export const primeAccountAge = (ids: string[]): Promise<void> => {
  if (!singleton) return Promise.resolve()
  return singleton.primeAccountAge(ids)
}

export const getAccountAge = (userId: string): Promise<AccountAgeRecord> => {
  if (!singleton) return Promise.resolve(heuristic(userId))
  return singleton.getAccountAge(userId)
}

export const _resetSingletonForTest = (): void => {
  singleton = null
}
