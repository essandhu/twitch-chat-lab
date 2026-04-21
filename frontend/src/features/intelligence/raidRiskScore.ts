import type { RiskBand } from '../filters/filterQueryTokens'
import type { AnomalySignals } from '../../types/twitch'

export interface Weights {
  similarityBurst: number
  newChatterInflux: number
  lexicalDiversityDrop: number
  emoteVsTextRatio: number
}

export const DEFAULT_WEIGHTS: Weights = {
  similarityBurst: 0.35,
  newChatterInflux: 0.25,
  lexicalDiversityDrop: 0.2,
  emoteVsTextRatio: 0.2,
}

export const computeRaidRiskScore = (
  signals: AnomalySignals,
  weights: Weights = DEFAULT_WEIGHTS,
): number => {
  const raw =
    weights.similarityBurst * signals.similarityBurst +
    weights.newChatterInflux * signals.newChatterInflux +
    weights.lexicalDiversityDrop * signals.lexicalDiversityDrop +
    weights.emoteVsTextRatio * signals.emoteVsTextRatio
  const scaled = raw * 100
  if (!Number.isFinite(scaled)) return 0
  return Math.round(Math.min(100, Math.max(0, scaled)))
}

export const bandFor = (score: number): RiskBand => {
  if (Number.isNaN(score)) return 'calm'
  if (score < 20) return 'calm'
  if (score <= 50) return 'elevated'
  if (score <= 80) return 'high'
  return 'critical'
}
