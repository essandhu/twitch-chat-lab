import type {
  EventAnnotation,
  ExtractedSignalRef,
  HeatmapDataPoint,
  Moment,
  MomentKind,
} from '../../types/twitch'
import { centroid, cosineSim } from './cosineSim'

const SEMANTIC_WINDOW_MS = 5 * 60_000
const SEMANTIC_MIN_CLUSTER = 5
const SEMANTIC_MERGE_THRESHOLD = 0.7
const SPIKE_MIN_RUN = 3
const SPIKE_MULTIPLIER = 2
const EMOTE_STORM_MIN_RUN = 5
const EMOTE_STORM_THRESHOLD = 0.75
const QA_WINDOW_MS = 30_000
const QA_MIN_COUNT = 3
const LABEL_MAX_LEN = 40

const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5 >>> 0
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const hashMomentId = (kind: MomentKind, startedAt: Date, firstRelatedMessageId: string): string =>
  fnv1a(`${kind}|${startedAt.toISOString()}|${firstRelatedMessageId}`)

const truncLabel = (s: string): string => (s.length <= LABEL_MAX_LEN ? s : s.slice(0, LABEL_MAX_LEN))

interface DetectInput {
  now: number
  heatmap: { dataPoints: HeatmapDataPoint[]; annotations: EventAnnotation[]; rollingAverage30s: number }
  intelligence: {
    emoteVsTextRatio: number
    emoteVsTextHistory: Array<{ t: number; v: number }>
    questions: ExtractedSignalRef[]
  }
  embeddings: Array<{ messageId: string; vector: Float32Array; t: number }>
  existingMomentIds: Set<string>
  labelResolver?: (messageId: string) => string
}

const buildMoment = (kind: MomentKind, startedAt: Date, endedAt: Date, label: string, relatedMessageIds: string[]): Moment => ({
  id: hashMomentId(kind, startedAt, relatedMessageIds[0] ?? ''),
  kind, startedAt, endedAt, label, relatedMessageIds,
})

const scanRuns = <T>(items: T[], above: (x: T) => boolean, minRun: number, emit: (start: number, end: number) => Moment | null): Moment[] => {
  const out: Moment[] = []
  let start = -1
  for (let i = 0; i <= items.length; i++) {
    const ok = i < items.length && above(items[i])
    if (ok && start === -1) start = i
    if (!ok && start !== -1) {
      if (i - start >= minRun) {
        const m = emit(start, i - 1)
        if (m) out.push(m)
      }
      start = -1
    }
  }
  return out
}

const detectSpikes = ({ heatmap }: DetectInput): Moment[] => {
  if (heatmap.dataPoints.length === 0 || heatmap.rollingAverage30s <= 0) return []
  const threshold = SPIKE_MULTIPLIER * heatmap.rollingAverage30s
  return scanRuns(
    heatmap.dataPoints,
    (dp) => dp.msgPerSec > threshold,
    SPIKE_MIN_RUN,
    (s, e) => {
      const runMax = heatmap.dataPoints.slice(s, e + 1).reduce((m, d) => Math.max(m, d.msgPerSec), 0)
      const ratio = runMax / heatmap.rollingAverage30s
      return buildMoment('spike', new Date(heatmap.dataPoints[s].timestamp), new Date(heatmap.dataPoints[e].timestamp), `Spike ×${ratio.toFixed(1)}`, [])
    },
  )
}

const detectEmoteStorms = ({ intelligence }: DetectInput): Moment[] =>
  scanRuns(
    intelligence.emoteVsTextHistory,
    (s) => s.v > EMOTE_STORM_THRESHOLD,
    EMOTE_STORM_MIN_RUN,
    (s, e) => buildMoment('emote-storm', new Date(intelligence.emoteVsTextHistory[s].t), new Date(intelligence.emoteVsTextHistory[e].t), 'Emote storm', []),
  )

const detectQaClusters = ({ intelligence }: DetectInput): Moment[] => {
  const qs = intelligence.questions
  if (qs.length < QA_MIN_COUNT) return []
  const out: Moment[] = []
  const seen = new Set<string>()
  for (let i = 0; i <= qs.length - QA_MIN_COUNT; i++) {
    const window = qs.slice(i, i + QA_MIN_COUNT)
    if (window[QA_MIN_COUNT - 1].timestamp - window[0].timestamp > QA_WINDOW_MS) continue
    const key = `${window[0].timestamp}:${window[0].messageId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(buildMoment('qa-cluster', new Date(window[0].timestamp), new Date(window[window.length - 1].timestamp), `${QA_MIN_COUNT}+ questions`, window.map((q) => q.messageId)))
  }
  return out
}

const detectRaids = ({ heatmap }: DetectInput): Moment[] => {
  const seen = new Set<string>()
  const out: Moment[] = []
  for (const a of heatmap.annotations) {
    if (a.type !== 'raid') continue
    const key = `${a.timestamp}|${a.label}`
    if (seen.has(key)) continue
    seen.add(key)
    const start = new Date(a.timestamp)
    out.push(buildMoment('raid', start, start, a.label, []))
  }
  return out
}

const mergeClustersOnce = (clusters: number[][], vectors: Float32Array[]): boolean => {
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const sim = cosineSim(centroid(clusters[i].map((k) => vectors[k])), centroid(clusters[j].map((k) => vectors[k])))
      if (sim > SEMANTIC_MERGE_THRESHOLD) {
        clusters[i] = [...clusters[i], ...clusters[j]]
        clusters.splice(j, 1)
        return true
      }
    }
  }
  return false
}

const detectSemanticClusters = (input: DetectInput): Moment[] => {
  const recent = input.embeddings.filter((e) => e.t > input.now - SEMANTIC_WINDOW_MS)
  if (recent.length < SEMANTIC_MIN_CLUSTER) return []
  const vectors = recent.map((r) => r.vector)
  const clusters: number[][] = recent.map((_, i) => [i])
  while (mergeClustersOnce(clusters, vectors)) {
    /* keep merging until stable */
  }
  const out: Moment[] = []
  for (const cluster of clusters) {
    if (cluster.length < SEMANTIC_MIN_CLUSTER) continue
    const c = centroid(cluster.map((k) => vectors[k]))
    let best = cluster[0]
    let bestSim = -Infinity
    for (const k of cluster) {
      const s = cosineSim(c, vectors[k])
      if (s > bestSim) { bestSim = s; best = k }
    }
    const ids = cluster.map((k) => recent[k].messageId)
    const times = cluster.map((k) => recent[k].t).sort((a, b) => a - b)
    const label = input.labelResolver ? input.labelResolver(recent[best].messageId) : recent[best].messageId
    out.push(buildMoment('semantic-cluster', new Date(times[0]), new Date(times[times.length - 1]), truncLabel(label), ids))
  }
  return out
}

export const detectMoments = (input: DetectInput): Moment[] => {
  const all = [
    ...detectSpikes(input),
    ...detectEmoteStorms(input),
    ...detectQaClusters(input),
    ...detectRaids(input),
    ...detectSemanticClusters(input),
  ]
  return all.filter((m) => !input.existingMomentIds.has(m.id))
}
