import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StressTestPage } from './StressTestPage'
import { buildSyntheticMessage, buildSyntheticBundle } from './syntheticChatGenerator'
import { useChatStore } from '../../store/chatStore'
import { useIntelligenceStore } from '../../store/intelligenceStore'
import { usePerfStore } from '../../store/perfStore'

const renderPage = () =>
  render(createElement(MemoryRouter, null, createElement(StressTestPage)))

const resetStores = () => {
  useChatStore.setState({
    messages: [],
    rows: [],
    messagesById: {},
    seenUserIds: new Set<string>(),
    firstTimers: [],
  })
  useIntelligenceStore.setState({ slices: {}, weightsOverride: null })
  usePerfStore.getState().reset()
}

describe('syntheticChatGenerator — deterministic purity', () => {
  it('returns identical content for the same seed across two runs', () => {
    const a = buildSyntheticMessage(42, 1_000_000)
    const b = buildSyntheticMessage(42, 2_000_000)
    expect(a.id).toBe(b.id)
    expect(a.userId).toBe(b.userId)
    expect(a.userLogin).toBe(b.userLogin)
    expect(a.text).toBe(b.text)
    expect(a.color).toBe(b.color)
    expect(a.badges).toEqual(b.badges)
    expect(a.fragments).toEqual(b.fragments)
    // Timestamps differ per the `now` arg
    expect(a.timestamp.getTime()).not.toBe(b.timestamp.getTime())
  })

  it('produces a ChannelChatMessageEvent compatible with chatStore.addMessage', () => {
    const { event } = buildSyntheticBundle(7, Date.now())
    expect(event.message_id).toBeTruthy()
    expect(event.chatter_user_id).toBeTruthy()
    expect(event.message.text).toBeTruthy()
    expect(Array.isArray(event.message.fragments)).toBe(true)
  })

  it('different seeds produce different content', () => {
    const a = buildSyntheticMessage(1, 0)
    const b = buildSyntheticMessage(999999, 0)
    expect(a.id).not.toBe(b.id)
  })
})

describe('StressTestPage — DOM + generator loop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStores()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetStores()
    vi.unstubAllEnvs()
  })

  it('renders rate selector with default value 1000 and all rate options', () => {
    renderPage()
    const sel = screen.getByTestId('stress-rate-select') as HTMLSelectElement
    expect(sel.value).toBe('1000')
    expect(sel.querySelectorAll('option').length).toBe(4)
  })

  it('at 1000 msg/s for 10 s dispatches ~10,000 messages (within 5%)', () => {
    renderPage()
    act(() => {
      fireEvent.click(screen.getByTestId('stress-start'))
    })
    act(() => {
      vi.advanceTimersByTime(10_100)
    })
    const total = useChatStore.getState().messages.length + /* buffer-capped evictions */ 0
    // Buffer cap is 5000; check raw count via rows + evictions via sent counter
    const sent = Number(screen.getByTestId('stress-sent').textContent?.replace(/[^\d]/g, '') ?? 0)
    expect(sent).toBeGreaterThanOrEqual(9500)
    expect(sent).toBeLessThanOrEqual(10500)
    // Also sanity-check some chat messages landed (capped)
    expect(total).toBeGreaterThan(0)
  })

  it('at 500 msg/s for 10 s dispatches ~5,000 messages (within 5%)', () => {
    renderPage()
    const sel = screen.getByTestId('stress-rate-select') as HTMLSelectElement
    act(() => { fireEvent.change(sel, { target: { value: '500' } }) })
    act(() => { fireEvent.click(screen.getByTestId('stress-start')) })
    act(() => { vi.advanceTimersByTime(10_100) })
    const sent = Number(screen.getByTestId('stress-sent').textContent?.replace(/[^\d]/g, '') ?? 0)
    expect(sent).toBeGreaterThanOrEqual(4750)
    expect(sent).toBeLessThanOrEqual(5250)
  })

  it('at 100 msg/s for 10 s dispatches ~1,000 messages (within 5%)', () => {
    renderPage()
    const sel = screen.getByTestId('stress-rate-select') as HTMLSelectElement
    act(() => { fireEvent.change(sel, { target: { value: '100' } }) })
    act(() => { fireEvent.click(screen.getByTestId('stress-start')) })
    act(() => { vi.advanceTimersByTime(10_100) })
    const sent = Number(screen.getByTestId('stress-sent').textContent?.replace(/[^\d]/g, '') ?? 0)
    expect(sent).toBeGreaterThanOrEqual(950)
    expect(sent).toBeLessThanOrEqual(1050)
  })

  it('Stop button halts generator mid-run', () => {
    renderPage()
    act(() => { fireEvent.click(screen.getByTestId('stress-start')) })
    act(() => { vi.advanceTimersByTime(3_000) })
    const mid = Number(screen.getByTestId('stress-sent').textContent?.replace(/[^\d]/g, '') ?? 0)
    act(() => { fireEvent.click(screen.getByTestId('stress-stop')) })
    act(() => { vi.advanceTimersByTime(5_000) })
    const after = Number(screen.getByTestId('stress-sent').textContent?.replace(/[^\d]/g, '') ?? 0)
    expect(mid).toBeGreaterThan(0)
    expect(after).toBe(mid)
  })

  it('forces PerfOverlay visible on mount', () => {
    expect(usePerfStore.getState().isVisible).toBe(false)
    renderPage()
    expect(usePerfStore.getState().isVisible).toBe(true)
  })
})

describe('StressTestPage — production env guard', () => {
  beforeEach(() => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders Not Found path when import.meta.env.DEV is false', () => {
    renderPage()
    expect(screen.getByTestId('stress-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('stress-page')).not.toBeInTheDocument()
  })
})
