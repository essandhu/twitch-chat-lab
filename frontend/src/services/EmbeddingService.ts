import type { EmbeddingRecord } from '../types/twitch'
import { logger } from '../lib/logger'

export type EmbeddingStatus = 'idle' | 'loading' | 'ready' | 'failed'

type OutboundFromWorker =
  | { type: 'ready' }
  | { type: 'loading'; progress: number }
  | { type: 'batch-result'; results: EmbeddingRecord[] }
  | { type: 'fatal'; reason: string }

type InboundToWorker =
  | { type: 'warm' }
  | { type: 'embed-batch'; items: Array<{ messageId: string; text: string }> }

interface WorkerLike {
  postMessage(msg: InboundToWorker): void
  addEventListener(type: 'message', cb: (evt: MessageEvent<OutboundFromWorker>) => void): void
  terminate(): void
}

const BATCH_FLUSH_MS = 500
const BATCH_MAX_SIZE = 16
const CACHE_MAX_ENTRIES = 10_000

export interface EmbeddingServiceDeps {
  workerFactory?: () => WorkerLike
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

interface QueuedItem {
  messageId: string
  text: string
  resolve: (rec: EmbeddingRecord) => void
  reject: (err: Error) => void
}

export class EmbeddingService {
  private workerFactory: () => WorkerLike
  private worker: WorkerLike | null = null
  private status: EmbeddingStatus = 'idle'
  private progress = 0
  private subscribers = new Set<(s: EmbeddingStatus, progress?: number) => void>()
  private queue: QueuedItem[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private pendingBatches: Array<{ items: QueuedItem[]; seen: Set<string> }> = []
  private cache = new Map<string, Float32Array>()
  private readyWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = []
  private setTimeoutImpl: typeof setTimeout
  private clearTimeoutImpl: typeof clearTimeout

  constructor(deps: EmbeddingServiceDeps = {}) {
    this.workerFactory =
      deps.workerFactory ??
      (() => new Worker(new URL('../workers/embeddingWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike)
    this.setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout
  }

  getStatus(): EmbeddingStatus {
    return this.status
  }

  onStatus(cb: (s: EmbeddingStatus, progress?: number) => void): () => void {
    this.subscribers.add(cb)
    cb(this.status, this.progress)
    return () => this.subscribers.delete(cb)
  }

  cacheSize(): number {
    return this.cache.size
  }

  hasEmbedding(messageId: string): boolean {
    return this.cache.has(messageId)
  }

  warm(): Promise<void> {
    this.ensureWorker()
    if (this.status === 'ready') return Promise.resolve()
    if (this.status === 'failed') return Promise.reject(new Error('embedding-service-failed'))
    return new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject })
      this.worker!.postMessage({ type: 'warm' })
    })
  }

  embed(text: string): Promise<Float32Array> {
    return this.embedBatch([{ messageId: `one:${text}`, text }]).then((r) => r[0].vector)
  }

  embedBatch(items: Array<{ messageId: string; text: string }>): Promise<EmbeddingRecord[]> {
    if (items.length === 0) return Promise.resolve([])
    this.ensureWorker()
    const cached: EmbeddingRecord[] = []
    const misses: Array<{ messageId: string; text: string }> = []
    for (const it of items) {
      const vec = this.cache.get(it.messageId)
      if (vec) cached.push({ messageId: it.messageId, vector: vec })
      else misses.push(it)
    }
    if (misses.length === 0) return Promise.resolve(cached)
    const pending = misses.map((it) => new Promise<EmbeddingRecord>((res, rej) => this.enqueue({ ...it, resolve: res, reject: rej })))
    return Promise.all(pending).then((fresh) => [...cached, ...fresh])
  }

  private enqueue(item: QueuedItem): void {
    this.queue.push(item)
    if (this.queue.length >= BATCH_MAX_SIZE) {
      this.flush()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = this.setTimeoutImpl(() => this.flush(), BATCH_FLUSH_MS)
  }

  private flush(): void {
    if (this.flushTimer) {
      this.clearTimeoutImpl(this.flushTimer)
      this.flushTimer = null
    }
    while (this.queue.length > 0) {
      const slice = this.queue.splice(0, BATCH_MAX_SIZE)
      const seen = new Set(slice.map((q) => q.messageId))
      this.pendingBatches.push({ items: slice, seen })
      this.worker!.postMessage({ type: 'embed-batch', items: slice.map((q) => ({ messageId: q.messageId, text: q.text })) })
    }
  }

  private ensureWorker(): void {
    if (this.worker) return
    this.worker = this.workerFactory()
    this.worker.addEventListener('message', (evt) => this.handleMessage(evt.data))
  }

  private setStatus(next: EmbeddingStatus, progress = 0): void {
    this.status = next
    this.progress = progress
    for (const cb of this.subscribers) cb(next, progress)
  }

  private handleMessage(msg: OutboundFromWorker): void {
    if (msg.type === 'loading') return this.setStatus('loading', msg.progress)
    if (msg.type === 'ready') {
      this.setStatus('ready', 1)
      for (const w of this.readyWaiters.splice(0)) w.resolve()
      return
    }
    if (msg.type === 'fatal') return this.failAll(msg.reason)
    const next = this.pendingBatches.shift()
    if (!next) return
    const byId = new Map(msg.results.map((r) => [r.messageId, r.vector]))
    for (const it of next.items) {
      const vec = byId.get(it.messageId)
      if (!vec) { it.reject(new Error(`embedding-missing:${it.messageId}`)); continue }
      this.storeInCache(it.messageId, vec)
      it.resolve({ messageId: it.messageId, vector: vec })
    }
  }

  private failAll(reason: string): void {
    const err = new Error(reason)
    logger.error('embedding.fatal', { reason })
    this.setStatus('failed')
    for (const w of this.readyWaiters.splice(0)) w.reject(err)
    for (const batch of this.pendingBatches) for (const it of batch.items) it.reject(err)
    this.pendingBatches = []
  }

  private storeInCache(messageId: string, vector: Float32Array): void {
    if (this.cache.has(messageId)) this.cache.delete(messageId)
    this.cache.set(messageId, vector)
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const first = this.cache.keys().next().value
      if (first === undefined) break
      this.cache.delete(first)
    }
  }
}

let singleton: EmbeddingService | null = null

export const getEmbeddingService = (): EmbeddingService => {
  if (!singleton) singleton = new EmbeddingService()
  return singleton
}

export const __resetEmbeddingServiceForTests = (): void => {
  singleton = null
}
