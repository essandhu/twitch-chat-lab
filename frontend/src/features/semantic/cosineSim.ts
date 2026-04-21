import type { SemanticSearchResult } from '../../types/twitch'

const UNIT_NORM_EPSILON = 1e-6

export const cosineSim = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]
    const bv = b[i]
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  if (Math.abs(normA - 1) < UNIT_NORM_EPSILON && Math.abs(normB - 1) < UNIT_NORM_EPSILON) return dot
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export const topK = (
  queryVec: Float32Array,
  entries: Array<{ messageId: string; vector: Float32Array }>,
  k: number,
): SemanticSearchResult[] => {
  if (entries.length === 0 || k <= 0) return []
  const scored: SemanticSearchResult[] = entries.map((e) => ({
    messageId: e.messageId,
    score: cosineSim(queryVec, e.vector),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

export const centroid = (vectors: Float32Array[]): Float32Array => {
  if (vectors.length === 0) return new Float32Array(0)
  const dim = vectors[0].length
  const out = new Float32Array(dim)
  for (const v of vectors) {
    if (v.length !== dim) continue
    for (let i = 0; i < dim; i++) out[i] += v[i]
  }
  const inv = 1 / vectors.length
  for (let i = 0; i < dim; i++) out[i] *= inv
  return out
}
