import type { EmbeddingRecord } from '../../types/twitch'

type Posted = { type: string; [k: string]: unknown }
type Result = { messageId: string; vector: Float32Array }

interface VectorResolver {
  (messageId: string, text: string): Float32Array
}

/**
 * Deterministic 8-dim mock worker for Phase 10 integration tests.
 *
 * Emits `{ type: 'ready' }` synchronously on `warm` and `{ type: 'batch-result' }`
 * with hand-constructed unit vectors on every `embed-batch`. The resolver is
 * pluggable so a test can project messageIds onto specific clusters.
 */
export class MockEmbeddingWorker {
  private listeners = new Set<(evt: MessageEvent) => void>()
  private resolver: VectorResolver
  public posted: Posted[] = []

  constructor(resolver: VectorResolver) {
    this.resolver = resolver
  }

  postMessage(msg: Posted): void {
    this.posted.push(msg)
    if (msg.type === 'warm') {
      queueMicrotask(() => this.emit({ type: 'ready' }))
      return
    }
    if (msg.type === 'embed-batch') {
      const items = msg.items as Array<{ messageId: string; text: string }>
      const results: EmbeddingRecord[] = items.map((it) => ({
        messageId: it.messageId,
        vector: this.resolver(it.messageId, it.text),
      }))
      queueMicrotask(() => this.emit({ type: 'batch-result', results }))
    }
  }

  addEventListener(_: 'message', cb: (evt: MessageEvent) => void): void {
    this.listeners.add(cb)
  }

  terminate(): void {
    this.listeners.clear()
  }

  private emit<T>(data: T): void {
    for (const cb of this.listeners) cb({ data } as MessageEvent<T>)
  }
}

export const normalize = (v: number[]): Float32Array => {
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return Float32Array.from(v.map((x) => x / norm))
}

export type { Result }
