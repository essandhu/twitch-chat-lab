import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { IntelligencePanel } from '../IntelligencePanel'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../../../store/intelligenceStore'
import { useMultiStreamStore } from '../../../store/multiStreamStore'
import { useChatStore } from '../../../store/chatStore'
import { ChatScrollContext } from '../../chat/chatScrollContext'
import type { ChatMessage, ExtractedSignalRef } from '../../../types/twitch'

vi.mock('../../../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

const TAB_KEY = 'tcl.intelligence.tab'

const makeMsg = (id: string, text: string, userId = 'u1'): ChatMessage => ({
  id,
  userId,
  userLogin: userId,
  displayName: userId,
  color: '#fff',
  badges: [],
  fragments: [{ type: 'text', text }],
  text,
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(1_000),
  messageType: 'text',
})

const seedSingleStream = (questions: ExtractedSignalRef[]) => {
  useIntelligenceStore.setState({
    slices: {
      [PRIMARY_STREAM_KEY]: {
        anomalySignals: { similarityBurst: 0, lexicalDiversityDrop: 0, emoteVsTextRatio: 0, newChatterInflux: 0 },
        raidRiskScore: 0,
        raidBand: 'calm',
        extractedSignals: { questions, callouts: [], bitsContext: [] },
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

describe('IntelligencePanel', () => {
  beforeEach(() => {
    useIntelligenceStore.getState().reset()
    useMultiStreamStore.getState().reset()
    useChatStore.getState().resetForNewChannel()
    try {
      localStorage.removeItem(TAB_KEY)
    } catch {
      // ignore
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('renders three tabs: Questions / Callouts / Bits', () => {
    render(<IntelligencePanel />)
    expect(screen.getByRole('tab', { name: /Questions/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Callouts/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Bits/ })).toBeInTheDocument()
  })

  it('persists tab selection to localStorage', async () => {
    render(<IntelligencePanel />)
    const calloutsTab = screen.getByRole('tab', { name: /Callouts/ })
    fireEvent.pointerDown(calloutsTab, { button: 0 })
    fireEvent.mouseDown(calloutsTab, { button: 0 })
    fireEvent.click(calloutsTab)
    await waitFor(() => expect(localStorage.getItem(TAB_KEY)).toBe('callout'))
    const bitsTab = screen.getByRole('tab', { name: /Bits/ })
    fireEvent.pointerDown(bitsTab, { button: 0 })
    fireEvent.mouseDown(bitsTab, { button: 0 })
    fireEvent.click(bitsTab)
    await waitFor(() => expect(localStorage.getItem(TAB_KEY)).toBe('bitsContext'))
  })

  it('renders the multi-stream stream selector when mode=multi and order.length > 0', () => {
    useMultiStreamStore.setState({
      order: ['alpha'],
      streams: {
        alpha: {
          login: 'alpha',
          displayName: 'Alpha',
          broadcasterId: 'b_a',
          messages: [],
          heatmap: { dataPoints: [], annotations: [], rollingAverage30s: 0, perfMetrics: { virtualizerRenderMs: 0 }, maxRate: 0 },
          lastEventAt: 0,
        } as never,
      },
    })
    render(<IntelligencePanel mode="multi" />)
    expect(screen.getByLabelText('Stream selector for intelligence panel')).toBeInTheDocument()
  })

  it('invokes ChatScrollContext on question row click in single-stream mode', () => {
    const msg = makeMsg('msg-42', 'is this a question?')
    useChatStore.setState({ messagesById: { [msg.id]: msg } } as never)
    seedSingleStream([{ messageId: 'msg-42', kind: 'question', timestamp: 1_000 }])

    const scrollSpy = vi.fn()
    render(
      <ChatScrollContext.Provider value={scrollSpy}>
        <IntelligencePanel />
      </ChatScrollContext.Provider>,
    )
    const row = screen.getByTestId('intelligence-row')
    fireEvent.click(row.querySelector('button')!)
    expect(scrollSpy).toHaveBeenCalledWith('msg-42')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })
})
