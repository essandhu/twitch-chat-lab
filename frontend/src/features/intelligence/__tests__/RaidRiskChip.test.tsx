import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { TooltipProvider } from '../../../components/ui/Tooltip'
import { RaidRiskChip } from '../RaidRiskChip'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../../../store/intelligenceStore'

const renderChip = (ui: ReactElement = <RaidRiskChip />) =>
  render(<TooltipProvider>{ui}</TooltipProvider>)

vi.mock('../../../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

const seedSlice = (overrides: Partial<{ band: 'calm' | 'elevated' | 'high' | 'critical'; score: number; signals: Record<string, number> }> = {}) => {
  const band = overrides.band ?? 'calm'
  const score = overrides.score ?? 0
  const signals = overrides.signals ?? {
    similarityBurst: 0.12,
    lexicalDiversityDrop: 0.34,
    emoteVsTextRatio: 0.56,
    newChatterInflux: 0.78,
  }
  useIntelligenceStore.setState({
    slices: {
      [PRIMARY_STREAM_KEY]: {
        anomalySignals: signals as never,
        raidRiskScore: score,
        raidBand: band,
        extractedSignals: { questions: [], callouts: [], bitsContext: [] },
        accountAge: {},
        recentMessages: [],
        signalHistory: [],
        emoteVsTextHistory: [],
        baselineTTR: 0,
        seenUserIds: new Set<string>(),
      },
    },
  })
}

describe('RaidRiskChip', () => {
  beforeEach(() => {
    useIntelligenceStore.getState().reset()
  })

  it('renders calm band by default when no slice exists', () => {
    renderChip()
    const chip = screen.getByTestId('raid-risk-chip')
    expect(chip).toBeInTheDocument()
    expect(chip.getAttribute('data-band')).toBe('calm')
    expect(chip.getAttribute('aria-label')).toBe('Raid risk: calm')
  })

  it('updates band when store transitions to elevated', () => {
    const { rerender } = renderChip()
    expect(screen.getByTestId('raid-risk-chip').getAttribute('data-band')).toBe('calm')
    seedSlice({ band: 'elevated', score: 42 })
    rerender(<TooltipProvider><RaidRiskChip /></TooltipProvider>)
    const chip = screen.getByTestId('raid-risk-chip')
    expect(chip.getAttribute('data-band')).toBe('elevated')
    expect(chip.textContent).toContain('42')
  })

  it('opens popover with two-decimal component scores on click', () => {
    seedSlice({
      band: 'high',
      score: 70,
      signals: {
        similarityBurst: 0.8234,
        lexicalDiversityDrop: 0.9123,
        emoteVsTextRatio: 0.1012,
        newChatterInflux: 0.6789,
      },
    })
    renderChip()
    const chip = screen.getByTestId('raid-risk-chip')
    fireEvent.click(chip)
    const popover = screen.getByTestId('raid-risk-popover')
    expect(popover).toBeInTheDocument()
    expect(popover.textContent).toContain('0.82')
    expect(popover.textContent).toContain('0.91')
    expect(popover.textContent).toContain('0.10')
    expect(popover.textContent).toContain('0.68')
  })
})
