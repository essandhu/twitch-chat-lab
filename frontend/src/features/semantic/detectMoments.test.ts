import { describe, expect, it } from 'vitest'
import { detectMoments, hashMomentId } from './detectMoments'
import type { EventAnnotation, ExtractedSignalRef, HeatmapDataPoint } from '../../types/twitch'

const f32 = (v: number[]): Float32Array => Float32Array.from(v)

const emptyInput = (now: number) => ({
  now,
  heatmap: {
    dataPoints: [] as HeatmapDataPoint[],
    annotations: [] as EventAnnotation[],
    rollingAverage30s: 0,
  },
  intelligence: {
    emoteVsTextRatio: 0,
    emoteVsTextHistory: [] as Array<{ t: number; v: number }>,
    questions: [] as ExtractedSignalRef[],
  },
  embeddings: [] as Array<{ messageId: string; vector: Float32Array; t: number }>,
  existingMomentIds: new Set<string>(),
})

describe('detectMoments — spike rule', () => {
  const rolling = 2
  const makeRun = (t0: number, seconds: number, perSec: number): HeatmapDataPoint[] =>
    Array.from({ length: seconds }, (_, i) => ({ timestamp: t0 + i * 1000, msgPerSec: perSec }))

  it('emits a spike when 3 consecutive seconds exceed 2× rolling average', () => {
    const inp = emptyInput(10_000)
    inp.heatmap.rollingAverage30s = rolling
    inp.heatmap.dataPoints = makeRun(1000, 3, 5)
    const out = detectMoments(inp)
    const spikes = out.filter((m) => m.kind === 'spike')
    expect(spikes).toHaveLength(1)
    expect(spikes[0].label).toMatch(/Spike/)
  })

  it('does not emit a spike for a 2-second run', () => {
    const inp = emptyInput(10_000)
    inp.heatmap.rollingAverage30s = rolling
    inp.heatmap.dataPoints = makeRun(1000, 2, 5)
    expect(detectMoments(inp).filter((m) => m.kind === 'spike')).toHaveLength(0)
  })

  it('emits two spikes for two 3-second runs separated by a gap', () => {
    const inp = emptyInput(30_000)
    inp.heatmap.rollingAverage30s = rolling
    inp.heatmap.dataPoints = [
      ...makeRun(1000, 3, 5),
      { timestamp: 4000, msgPerSec: 1 },
      { timestamp: 5000, msgPerSec: 1 },
      ...makeRun(6000, 3, 5),
    ]
    const spikes = detectMoments(inp).filter((m) => m.kind === 'spike')
    expect(spikes).toHaveLength(2)
  })
})

describe('detectMoments — emote-storm rule', () => {
  const storm = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ t: 1000 + i * 1000, v: 0.9 }))

  it('emits an emote-storm for a 5-second sustained window', () => {
    const inp = emptyInput(10_000)
    inp.intelligence.emoteVsTextHistory = storm(5)
    expect(detectMoments(inp).filter((m) => m.kind === 'emote-storm')).toHaveLength(1)
  })

  it('does not emit for a 4-second window', () => {
    const inp = emptyInput(10_000)
    inp.intelligence.emoteVsTextHistory = storm(4)
    expect(detectMoments(inp).filter((m) => m.kind === 'emote-storm')).toHaveLength(0)
  })
})

describe('detectMoments — qa-cluster rule', () => {
  const mkQ = (id: string, t: number): ExtractedSignalRef => ({ messageId: id, kind: 'question', timestamp: t })

  it('emits when 3 questions land within a 30s window', () => {
    const inp = emptyInput(60_000)
    inp.intelligence.questions = [mkQ('q1', 1000), mkQ('q2', 10_000), mkQ('q3', 25_000)]
    expect(detectMoments(inp).filter((m) => m.kind === 'qa-cluster')).toHaveLength(1)
  })

  it('does not emit for 2 questions', () => {
    const inp = emptyInput(60_000)
    inp.intelligence.questions = [mkQ('q1', 1000), mkQ('q2', 2000)]
    expect(detectMoments(inp).filter((m) => m.kind === 'qa-cluster')).toHaveLength(0)
  })

  it('does not emit when 3 questions are spread beyond 30s', () => {
    const inp = emptyInput(120_000)
    inp.intelligence.questions = [mkQ('q1', 1000), mkQ('q2', 20_000), mkQ('q3', 40_000)]
    expect(detectMoments(inp).filter((m) => m.kind === 'qa-cluster')).toHaveLength(0)
  })
})

describe('detectMoments — raid rule', () => {
  it('projects raid annotations 1:1', () => {
    const inp = emptyInput(60_000)
    inp.heatmap.annotations = [
      { timestamp: 10_000, type: 'raid', label: 'Raid from alpha' },
      { timestamp: 20_000, type: 'raid', label: 'Raid from beta' },
      { timestamp: 30_000, type: 'subscription', label: 'sub' },
    ]
    const raids = detectMoments(inp).filter((m) => m.kind === 'raid')
    expect(raids).toHaveLength(2)
  })

  it('dedups duplicate raid annotations by id', () => {
    const inp = emptyInput(60_000)
    inp.heatmap.annotations = [
      { timestamp: 10_000, type: 'raid', label: 'Raid A' },
      { timestamp: 10_000, type: 'raid', label: 'Raid A' },
    ]
    expect(detectMoments(inp).filter((m) => m.kind === 'raid')).toHaveLength(1)
  })
})

describe('detectMoments — semantic-cluster rule', () => {
  const unit = (angle: number): Float32Array => f32([Math.cos(angle), Math.sin(angle)])

  it('emits one cluster for 5 messages with intra-cosine > 0.7', () => {
    const inp = emptyInput(60_000)
    inp.embeddings = Array.from({ length: 5 }, (_, i) => ({
      messageId: `m${i}`,
      vector: unit(0.01 * i),
      t: 30_000 + i * 1000,
    }))
    const clusters = detectMoments({ ...inp, labelResolver: () => 'boss fight go' }).filter((m) => m.kind === 'semantic-cluster')
    expect(clusters).toHaveLength(1)
    expect(clusters[0].relatedMessageIds.length).toBeGreaterThanOrEqual(5)
  })

  it('does not emit for 4 tightly clustered messages', () => {
    const inp = emptyInput(60_000)
    inp.embeddings = Array.from({ length: 4 }, (_, i) => ({
      messageId: `m${i}`,
      vector: unit(0.01 * i),
      t: 30_000 + i * 1000,
    }))
    expect(detectMoments(inp).filter((m) => m.kind === 'semantic-cluster')).toHaveLength(0)
  })

  it('excludes embeddings older than 5 minutes', () => {
    const inp = emptyInput(60_000 + 6 * 60_000)
    inp.embeddings = Array.from({ length: 5 }, (_, i) => ({
      messageId: `m${i}`,
      vector: unit(0.01 * i),
      t: 30_000 + i * 1000, // all too old
    }))
    expect(detectMoments(inp).filter((m) => m.kind === 'semantic-cluster')).toHaveLength(0)
  })

  it('truncates label to 40 chars', () => {
    const inp = emptyInput(60_000)
    inp.embeddings = Array.from({ length: 5 }, (_, i) => ({
      messageId: `m${i}`,
      vector: unit(0.01 * i),
      t: 30_000 + i * 1000,
    }))
    const long = 'x'.repeat(100)
    const clusters = detectMoments({ ...inp, labelResolver: () => long }).filter((m) => m.kind === 'semantic-cluster')
    expect(clusters[0].label.length).toBeLessThanOrEqual(40)
  })
})

describe('detectMoments — idempotency and hashMomentId', () => {
  it('skips moments whose id is already in existingMomentIds', () => {
    const inp = emptyInput(10_000)
    inp.heatmap.rollingAverage30s = 2
    inp.heatmap.dataPoints = [
      { timestamp: 1000, msgPerSec: 5 },
      { timestamp: 2000, msgPerSec: 5 },
      { timestamp: 3000, msgPerSec: 5 },
    ]
    const first = detectMoments(inp)
    expect(first).toHaveLength(1)
    const seen = new Set(first.map((m) => m.id))
    const second = detectMoments({ ...inp, existingMomentIds: seen })
    expect(second).toHaveLength(0)
  })

  it('hashMomentId is deterministic across invocations', () => {
    const a = hashMomentId('spike', new Date(1000), 'm1')
    const b = hashMomentId('spike', new Date(1000), 'm1')
    expect(a).toBe(b)
  })

  it('hashMomentId differs when startedAt differs by 1 ms', () => {
    expect(hashMomentId('spike', new Date(1000), 'm1')).not.toBe(hashMomentId('spike', new Date(1001), 'm1'))
  })

  it('hashMomentId differs across kinds', () => {
    expect(hashMomentId('spike', new Date(1000), 'm1')).not.toBe(hashMomentId('raid', new Date(1000), 'm1'))
  })

  it('hashMomentId works with empty relatedMessageIds', () => {
    const id = hashMomentId('spike', new Date(1000), '')
    expect(id).toMatch(/^[0-9a-f]+$/)
  })
})
