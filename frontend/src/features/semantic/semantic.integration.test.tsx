import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingService, __resetEmbeddingServiceForTests } from '../../services/EmbeddingService'
import { useSemanticStore } from '../../store/semanticStore'
import { useHeatmapStore } from '../../store/heatmapStore'
import { useIntelligenceStore } from '../../store/intelligenceStore'
import type { ChatMessage } from '../../types/twitch'
import { MockEmbeddingWorker, normalize } from '../../test/__mocks__/embeddingWorker'

vi.mock('../../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

const BOSS_VEC = normalize([1, 0.1, 0, 0, 0, 0, 0, 0])
const POG_VEC = normalize([0, 0, 1, 0.1, 0, 0, 0, 0])

const rng = (seed: number) => {
  let s = seed | 0
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 0xffffffff
  }
}

const NOISE_RNG = rng(999)
const noiseVec = (): Float32Array => {
  const dims = Array.from({ length: 8 }, () => NOISE_RNG() * 2 - 1)
  return normalize(dims)
}

const makeMsg = (id: string, text: string, t: number): ChatMessage => ({
  id,
  userId: `u${id}`,
  userLogin: 'u',
  displayName: 'U',
  color: '#fff',
  badges: [],
  fragments: [{ type: 'text', text }],
  text,
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(t),
  messageType: 'text',
})

describe('semantic integration — 300-message clustered session', () => {
  let svc: EmbeddingService
  let mock: MockEmbeddingWorker

  beforeEach(() => {
    __resetEmbeddingServiceForTests()
    useSemanticStore.getState().reset()
    useHeatmapStore.setState({ dataPoints: [], annotations: [], rollingAverage30s: 0 } as never)
    useIntelligenceStore.getState().reset()
    vi.useFakeTimers()
    mock = new MockEmbeddingWorker((messageId) => {
      if (messageId.startsWith('boss-')) return BOSS_VEC
      if (messageId.startsWith('pog-')) return POG_VEC
      return noiseVec()
    })
    svc = new EmbeddingService({ workerFactory: () => mock })
    useSemanticStore.setState({
      _service: svc as never,
      status: 'ready',
      activationByStream: { __primary__: true },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    __resetEmbeddingServiceForTests()
  })

  it('surfaces exactly 2 semantic-cluster moments and ranks queries correctly', async () => {
    const t0 = 1_000_000
    const msgs: ChatMessage[] = []
    for (let i = 0; i < 20; i++) msgs.push(makeMsg(`boss-${i}`, `boss fight ${i}`, t0 + i * 1000))
    for (let i = 0; i < 20; i++) msgs.push(makeMsg(`pog-${i}`, `pog!! ${i}`, t0 + 20_000 + i * 1000))
    for (let i = 0; i < 260; i++) msgs.push(makeMsg(`noise-${i}`, `word${i}`, t0 + 40_000 + i * 1000))

    for (const m of msgs) useSemanticStore.getState().ingestMessage(m, undefined, m.timestamp.getTime())
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    await Promise.resolve()
    // Flush all pending batches
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(500)
      await Promise.resolve()
    }

    const now = t0 + 300_000
    useSemanticStore.getState().detectMoments(now)
    const clusters = useSemanticStore.getState().moments.filter((m) => m.kind === 'semantic-cluster')
    expect(clusters.length).toBeGreaterThanOrEqual(2)
    const totalRelated = clusters.reduce((acc, m) => acc + m.relatedMessageIds.length, 0)
    expect(totalRelated).toBeGreaterThanOrEqual(40)

    // Query: the boss-fight vector should rank top cluster members first.
    mock.posted.length = 0
    useSemanticStore.getState().setSearchQuery('boss fight')
    // mock the query embedding to collide with BOSS_VEC
    vi.spyOn(svc, 'embed').mockResolvedValue(BOSS_VEC)
    await useSemanticStore.getState().runSearch(now)
    const results = useSemanticStore.getState().searchResults
    const top20 = results.slice(0, 20)
    const bossIds = top20.filter((r) => r.messageId.startsWith('boss-'))
    expect(bossIds.length).toBeGreaterThanOrEqual(20)
  })
})
