import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../types/twitch'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from './intelligenceStore'
import { useSemanticStore } from './semanticStore'
import { useHeatmapStore } from './heatmapStore'

vi.mock('../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

const f32 = (n: number): Float32Array => Float32Array.from([n])

class FakeService {
  status: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
  embedBatch = vi.fn()
  embed = vi.fn()
  warm = vi.fn(async () => {
    this.status = 'ready'
    this.fire()
  })
  private cbs: Array<(s: string) => void> = []
  getStatus(): string {
    return this.status
  }
  onStatus(cb: (s: string) => void): () => void {
    this.cbs.push(cb)
    cb(this.status)
    return () => {
      this.cbs = this.cbs.filter((x) => x !== cb)
    }
  }
  private fire(): void {
    for (const cb of this.cbs) cb(this.status)
  }
  setStatus(next: 'idle' | 'loading' | 'ready' | 'failed'): void {
    this.status = next
    this.fire()
  }
}

vi.mock('../services/EmbeddingService', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    getEmbeddingService: () => (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__,
  }
})

const makeMsg = (id: string, text = 'hello'): ChatMessage => ({
  id,
  userId: 'u1',
  userLogin: 'u1',
  displayName: 'U1',
  color: '#fff',
  badges: [],
  fragments: [{ type: 'text', text }],
  text,
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(1000),
  messageType: 'text',
})

describe('semanticStore', () => {
  beforeEach(() => {
    ;(globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__ = new FakeService()
    useSemanticStore.getState().reset()
    useIntelligenceStore.getState().reset()
    useHeatmapStore.setState({ dataPoints: [], annotations: [], rollingAverage30s: 0 } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('activate() flips isActivated and triggers warm()', async () => {
    const fake = (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__!
    await useSemanticStore.getState().activate()
    expect(useSemanticStore.getState().isActivated).toBe(true)
    expect(fake.warm).toHaveBeenCalled()
    expect(useSemanticStore.getState().activationByStream[PRIMARY_STREAM_KEY]).toBe(true)
  })

  it('mirrors EmbeddingService status updates', async () => {
    const fake = (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__!
    await useSemanticStore.getState().activate()
    expect(useSemanticStore.getState().status).toBe('ready')
    fake.setStatus('failed')
    expect(useSemanticStore.getState().status).toBe('failed')
  })

  it('ingestMessage skips when activationByStream is false for the login', () => {
    const fake = (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__!
    fake.setStatus('ready')
    useSemanticStore.setState({ _service: fake as never, status: 'ready' })
    useSemanticStore.getState().ingestMessage(makeMsg('m1'), 'streamA')
    expect(fake.embedBatch).not.toHaveBeenCalled()
  })

  it('ingestMessage skips when status is not ready', async () => {
    const fake = (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__!
    useSemanticStore.setState({
      activationByStream: { [PRIMARY_STREAM_KEY]: true },
      _service: fake as never,
      status: 'loading',
    })
    useSemanticStore.getState().ingestMessage(makeMsg('m1'))
    expect(fake.embedBatch).not.toHaveBeenCalled()
  })

  it('ingestMessage stores vector on batch resolve', async () => {
    const fake = (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__!
    fake.embedBatch.mockResolvedValue([{ messageId: 'm1', vector: f32(0.5) }])
    useSemanticStore.setState({
      activationByStream: { [PRIMARY_STREAM_KEY]: true },
      _service: fake as never,
      status: 'ready',
    })
    useSemanticStore.getState().ingestMessage(makeMsg('m1'), undefined, 2000)
    await Promise.resolve()
    await Promise.resolve()
    expect(useSemanticStore.getState().embeddings['m1']).toBeDefined()
    expect(useSemanticStore.getState().embeddingTimestamps['m1']).toBe(2000)
  })

  it('setSearchQuery stores the query but does not run search', () => {
    useSemanticStore.getState().setSearchQuery('pog')
    expect(useSemanticStore.getState().searchQuery).toBe('pog')
    expect(useSemanticStore.getState().searchResults).toHaveLength(0)
  })

  it('runSearch populates searchResults sorted by cosine', async () => {
    const fake = (globalThis as { __fakeEmbedding__?: FakeService }).__fakeEmbedding__!
    fake.embed.mockResolvedValue(Float32Array.from([1, 0]))
    useSemanticStore.setState({
      activationByStream: { [PRIMARY_STREAM_KEY]: true },
      _service: fake as never,
      status: 'ready',
      searchQuery: 'query',
      embeddings: {
        a: Float32Array.from([0, 1]),
        b: Float32Array.from([1, 0]),
        c: Float32Array.from([0.7, 0.7]),
      },
    })
    await useSemanticStore.getState().runSearch(5000)
    const res = useSemanticStore.getState().searchResults
    expect(res[0].messageId).toBe('b')
    expect(res[1].messageId).toBe('c')
  })

  it('runSearch empties results when query is under 2 chars', async () => {
    useSemanticStore.setState({ searchQuery: 'a' })
    await useSemanticStore.getState().runSearch(1000)
    expect(useSemanticStore.getState().searchResults).toHaveLength(0)
    expect(useSemanticStore.getState().lastSearchAt).toBe(1000)
  })

  it('detectMoments merges new moments deduplicated by id', () => {
    const annotations = [
      { timestamp: 5000, type: 'raid' as const, label: 'Raid A' },
      { timestamp: 6000, type: 'raid' as const, label: 'Raid B' },
    ]
    useHeatmapStore.setState({
      dataPoints: [],
      annotations,
      rollingAverage30s: 0,
    } as never)
    useSemanticStore.getState().detectMoments(10_000)
    expect(useSemanticStore.getState().moments).toHaveLength(2)
    useSemanticStore.getState().detectMoments(10_000)
    expect(useSemanticStore.getState().moments).toHaveLength(2)
  })

  it('reset clears all state', () => {
    useSemanticStore.setState({
      isActivated: true,
      activationByStream: { a: true },
      status: 'ready',
      embeddings: { x: f32(1) },
      moments: [],
      searchQuery: 'hi',
    })
    useSemanticStore.getState().reset()
    const s = useSemanticStore.getState()
    expect(s.isActivated).toBe(false)
    expect(s.status).toBe('idle')
    expect(Object.keys(s.embeddings)).toHaveLength(0)
    expect(s.searchQuery).toBe('')
  })

  it('activationByStream multi-stream: secondary stream defaults off', () => {
    expect(useSemanticStore.getState().activationByStream['secondary']).toBeUndefined()
  })
})
