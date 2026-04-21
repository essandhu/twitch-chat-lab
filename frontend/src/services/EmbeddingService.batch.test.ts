import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingService } from './EmbeddingService'
import type { EmbeddingRecord } from '../types/twitch'

type InboundToWorker =
  | { type: 'warm' }
  | { type: 'embed-batch'; items: Array<{ messageId: string; text: string }> }

class MockWorker {
  private listeners = new Set<(evt: MessageEvent) => void>()
  posts: InboundToWorker[] = []
  postMessage(msg: InboundToWorker): void {
    this.posts.push(msg)
  }
  addEventListener(_: 'message', cb: (evt: MessageEvent) => void): void {
    this.listeners.add(cb)
  }
  terminate(): void {
    this.listeners.clear()
  }
  emit<T>(data: T): void {
    for (const cb of this.listeners) cb({ data } as MessageEvent<T>)
  }
}

const unit = (n: number): Float32Array => Float32Array.from([n])

describe('EmbeddingService — batching, cache, status', () => {
  let worker: MockWorker
  let svc: EmbeddingService

  beforeEach(() => {
    vi.useFakeTimers()
    worker = new MockWorker()
    svc = new EmbeddingService({ workerFactory: () => worker })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid embed calls within 500 ms into a single batch', async () => {
    svc.embedBatch([{ messageId: 'a', text: 'a' }])
    svc.embedBatch([{ messageId: 'b', text: 'b' }])
    svc.embedBatch([{ messageId: 'c', text: 'c' }])
    expect(worker.posts.filter((p) => p.type === 'embed-batch')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    const batches = worker.posts.filter((p): p is { type: 'embed-batch'; items: Array<{ messageId: string; text: string }> } => p.type === 'embed-batch')
    expect(batches).toHaveLength(1)
    expect(batches[0].items).toHaveLength(3)
  })

  it('caps a single post at 16 items and splits the 17th into a second post', async () => {
    const items = Array.from({ length: 17 }, (_, i) => ({ messageId: `m${i}`, text: `${i}` }))
    svc.embedBatch(items)
    const batches = worker.posts.filter((p): p is { type: 'embed-batch'; items: Array<{ messageId: string; text: string }> } => p.type === 'embed-batch')
    expect(batches).toHaveLength(1)
    expect(batches[0].items).toHaveLength(16)
    await vi.advanceTimersByTimeAsync(500)
    const all = worker.posts.filter((p): p is { type: 'embed-batch'; items: Array<{ messageId: string; text: string }> } => p.type === 'embed-batch')
    expect(all).toHaveLength(2)
    expect(all[1].items).toHaveLength(1)
  })

  it('returns cached vectors without re-posting to the worker', async () => {
    const p1 = svc.embedBatch([{ messageId: 'x', text: 'x' }])
    await vi.advanceTimersByTimeAsync(500)
    worker.emit({ type: 'batch-result', results: [{ messageId: 'x', vector: unit(1) }] satisfies EmbeddingRecord[] })
    await p1
    const postsBefore = worker.posts.length
    const cached = await svc.embedBatch([{ messageId: 'x', text: 'x' }])
    expect(cached[0].vector[0]).toBe(1)
    expect(worker.posts.length).toBe(postsBefore)
  })

  it('onStatus fires for every transition and supports unsubscribe', async () => {
    const events: Array<{ status: string; progress?: number }> = []
    const unsub = svc.onStatus((s, p) => events.push({ status: s, progress: p }))
    void svc.warm()
    worker.emit({ type: 'loading', progress: 0.3 })
    worker.emit({ type: 'ready' })
    expect(events.map((e) => e.status)).toEqual(['idle', 'loading', 'ready'])
    expect(svc.getStatus()).toBe('ready')
    unsub()
    worker.emit({ type: 'loading', progress: 0.9 })
    expect(events).toHaveLength(3)
  })

  it('FIFO eviction at 10,000 entries drops the oldest', async () => {
    const LARGE = 10_001
    const items = Array.from({ length: LARGE }, (_, i) => ({ messageId: `m${i}`, text: `${i}` }))
    const promise = svc.embedBatch(items)
    // Drive batches: each flush posts multiple batches sync inside flush()
    await vi.advanceTimersByTimeAsync(500)
    // Respond to each pending batch
    let posted = worker.posts.filter((p) => p.type === 'embed-batch') as Array<{ type: 'embed-batch'; items: Array<{ messageId: string; text: string }> }>
    for (const b of posted) {
      worker.emit({
        type: 'batch-result',
        results: b.items.map((it) => ({ messageId: it.messageId, vector: unit(1) })),
      })
    }
    // Flush any leftover timer
    await vi.advanceTimersByTimeAsync(500)
    posted = worker.posts.filter((p) => p.type === 'embed-batch') as Array<{ type: 'embed-batch'; items: Array<{ messageId: string; text: string }> }>
    // Process the rest until all resolved
    for (const b of posted.slice(Math.ceil(LARGE / 16))) {
      worker.emit({
        type: 'batch-result',
        results: b.items.map((it) => ({ messageId: it.messageId, vector: unit(1) })),
      })
    }
    await promise
    expect(svc.cacheSize()).toBe(10_000)
    expect(svc.hasEmbedding('m0')).toBe(false)
    expect(svc.hasEmbedding(`m${LARGE - 1}`)).toBe(true)
  })
})
