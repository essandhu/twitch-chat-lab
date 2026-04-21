import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrubBar } from './ScrubBar'
import { sessionReplayer } from '../auth/authServices'
import { useSemanticStore } from '../../store/semanticStore'
import type { Moment } from '../../types/twitch'

const originalSearch = window.location.search

const enterReplayMode = () => {
  window.history.replaceState({}, '', '/?replay=1')
}
const exitReplayMode = () => {
  window.history.replaceState({}, '', '/')
}

const stubReplayer = (opts: { duration?: number; firstT?: number; position?: number } = {}) => {
  vi.spyOn(sessionReplayer, 'getDuration').mockReturnValue(opts.duration ?? 60_000)
  vi.spyOn(sessionReplayer, 'getFirstT').mockReturnValue(opts.firstT ?? 1_000_000)
  vi.spyOn(sessionReplayer, 'getPosition').mockReturnValue(opts.position ?? 0)
  vi.spyOn(sessionReplayer, 'isPlaying').mockReturnValue(false)
  vi.spyOn(sessionReplayer, 'onPositionChange').mockReturnValue(() => {})
}

const makeMoment = (overrides: Partial<Moment> & { id: string; startedAt: Date }): Moment => ({
  kind: 'spike',
  endedAt: overrides.startedAt,
  label: 'test moment',
  relatedMessageIds: [],
  ...overrides,
})

describe('ScrubBar', () => {
  beforeEach(() => {
    useSemanticStore.setState({ moments: [] })
  })
  afterEach(() => {
    window.history.replaceState({}, '', `/${originalSearch}`)
    useSemanticStore.setState({ moments: [] })
    vi.restoreAllMocks()
  })

  it('renders nothing when not in replay mode', () => {
    exitReplayMode()
    stubReplayer()
    render(<ScrubBar />)
    expect(screen.queryByTestId('scrub-bar')).toBeNull()
  })

  it('renders root with scrub-bar testid when in replay mode', () => {
    enterReplayMode()
    stubReplayer()
    render(<ScrubBar />)
    expect(screen.getByTestId('scrub-bar')).toBeInTheDocument()
    expect(screen.getByTestId('scrub-thumb')).toBeInTheDocument()
    expect(screen.getByTestId('scrub-speed')).toBeInTheDocument()
  })

  it('Play button wires to sessionReplayer.play and reveals Pause', () => {
    enterReplayMode()
    stubReplayer()
    const playSpy = vi.spyOn(sessionReplayer, 'play').mockImplementation(() => {})
    render(<ScrubBar />)
    const playBtn = screen.getByTestId('scrub-play')
    fireEvent.click(playBtn)
    expect(playSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('scrub-pause')).toBeInTheDocument()
    expect(screen.queryByTestId('scrub-play')).toBeNull()
  })

  it('Pause button wires to sessionReplayer.pause', () => {
    enterReplayMode()
    stubReplayer()
    vi.spyOn(sessionReplayer, 'play').mockImplementation(() => {})
    const pauseSpy = vi.spyOn(sessionReplayer, 'pause').mockImplementation(() => {})
    render(<ScrubBar />)
    fireEvent.click(screen.getByTestId('scrub-play'))
    fireEvent.click(screen.getByTestId('scrub-pause'))
    expect(pauseSpy).toHaveBeenCalledTimes(1)
  })

  it('Speed change wires to sessionReplayer.setSpeed', () => {
    enterReplayMode()
    stubReplayer()
    const setSpeedSpy = vi.spyOn(sessionReplayer, 'setSpeed').mockImplementation(() => {})
    render(<ScrubBar />)
    const select = screen.getByTestId('scrub-speed') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '2' } })
    expect(setSpeedSpy).toHaveBeenCalledWith(2)
    fireEvent.change(select, { target: { value: '0.5' } })
    expect(setSpeedSpy).toHaveBeenCalledWith(0.5)
  })

  it('renders a moment tick per semanticStore.moments with correct data-kind', () => {
    enterReplayMode()
    const firstT = 1_000_000
    stubReplayer({ duration: 60_000, firstT })
    const moments: Moment[] = [
      makeMoment({ id: 'm1', kind: 'spike', startedAt: new Date(firstT + 10_000) }),
      makeMoment({ id: 'm2', kind: 'raid', startedAt: new Date(firstT + 30_000) }),
      makeMoment({ id: 'm3', kind: 'semantic-cluster', startedAt: new Date(firstT + 45_000) }),
    ]
    useSemanticStore.setState({ moments })
    render(<ScrubBar />)
    const ticks = screen.getAllByTestId('scrub-moment-tick')
    expect(ticks).toHaveLength(3)
    const kinds = ticks.map((t) => t.getAttribute('data-kind'))
    expect(kinds).toEqual(['spike', 'raid', 'semantic-cluster'])
  })

  it('clicking a moment tick calls sessionReplayer.seekTo with offset from firstT', () => {
    enterReplayMode()
    const firstT = 2_000_000
    stubReplayer({ duration: 120_000, firstT })
    const seekSpy = vi.spyOn(sessionReplayer, 'seekTo').mockImplementation(() => {})
    useSemanticStore.setState({
      moments: [makeMoment({ id: 'm1', kind: 'spike', startedAt: new Date(firstT + 42_000) })],
    })
    render(<ScrubBar />)
    const tick = screen.getByTestId('scrub-moment-tick')
    fireEvent.click(tick)
    expect(seekSpy).toHaveBeenCalledWith(42_000)
  })
})
