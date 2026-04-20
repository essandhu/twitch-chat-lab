import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelixStream } from '../../types/twitch'

const getStreamsByCategory = vi.fn<(gameId: string, first: number) => Promise<HelixStream[]>>()

vi.mock('../auth/authServices', () => ({
  twitchHelixClient: {
    getStreamsByCategory: (...args: [string, number]) => getStreamsByCategory(...args),
  },
}))

// Import after vi.mock so the mocked module resolves.
import { StreamSelector } from './StreamSelector'

const helixStream = (login: string, name: string, viewerCount = 100): HelixStream => ({
  id: `id_${login}`,
  user_id: `uid_${login}`,
  user_login: login,
  user_name: name,
  title: `${name}'s stream`,
  game_id: 'g1',
  game_name: 'Game',
  viewer_count: viewerCount,
  started_at: new Date().toISOString(),
  thumbnail_url: '',
})

describe('StreamSelector', () => {
  beforeEach(() => {
    getStreamsByCategory.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading state while getStreamsByCategory is pending', () => {
    // Pending promise that never resolves during the test.
    getStreamsByCategory.mockReturnValue(new Promise(() => {}))

    render(
      <StreamSelector
        gameId="g1"
        currentLogin="broadcaster"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/finding streams/i)).toBeInTheDocument()
  })

  it('renders results and excludes currentLogin from the list', async () => {
    getStreamsByCategory.mockResolvedValue([
      helixStream('broadcaster', 'Broadcaster', 500),
      helixStream('alice', 'Alice', 200),
      helixStream('bob', 'Bob', 300),
    ])

    render(
      <StreamSelector
        gameId="g1"
        currentLogin="broadcaster"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
    expect(screen.getByText('Bob')).toBeInTheDocument()
    // The current broadcaster must not appear in the picker.
    expect(screen.queryByText('Broadcaster')).not.toBeInTheDocument()
  })

  it('Compare is disabled until 1–2 are selected; clicking fires onConfirm with selected picks', async () => {
    getStreamsByCategory.mockResolvedValue([
      helixStream('alice', 'Alice'),
      helixStream('bob', 'Bob'),
    ])

    const onConfirm = vi.fn()
    render(
      <StreamSelector
        gameId="g1"
        currentLogin="broadcaster"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    const compareBtn = screen.getByRole('button', { name: /compare/i })
    expect(compareBtn).toBeDisabled()

    // Select Alice — should enable.
    fireEvent.click(screen.getByLabelText('Select Alice'))
    expect(compareBtn).not.toBeDisabled()

    // Select Bob — still enabled (2 is valid).
    fireEvent.click(screen.getByLabelText('Select Bob'))
    expect(compareBtn).not.toBeDisabled()

    fireEvent.click(compareBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const picks = onConfirm.mock.calls[0]![0] as Array<{
      login: string
      displayName: string
      broadcasterId: string
    }>
    expect(picks).toHaveLength(2)
    expect(picks.map((p) => p.login).sort()).toEqual(['alice', 'bob'])
    const alice = picks.find((p) => p.login === 'alice')!
    expect(alice.displayName).toBe('Alice')
    expect(alice.broadcasterId).toBe('uid_alice')
  })

  it('pre-checks initialSelected entries and enables Compare immediately', async () => {
    getStreamsByCategory.mockResolvedValue([
      helixStream('alice', 'Alice'),
      helixStream('bob', 'Bob'),
    ])

    const onConfirm = vi.fn()
    render(
      <StreamSelector
        gameId="g1"
        currentLogin="broadcaster"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        initialSelected={[
          { login: 'alice', displayName: 'Alice', broadcasterId: 'uid_alice' },
        ]}
      />,
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Select Alice')).toBeChecked(),
    )
    expect(screen.getByLabelText('Select Bob')).not.toBeChecked()

    const compareBtn = screen.getByRole('button', { name: /compare/i })
    expect(compareBtn).not.toBeDisabled()

    fireEvent.click(compareBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const picks = onConfirm.mock.calls[0]![0] as Array<{ login: string; broadcasterId: string }>
    expect(picks.map((p) => p.login)).toEqual(['alice'])
    expect(picks[0]!.broadcasterId).toBe('uid_alice')
  })

  it('includes pre-selected channels that are missing from the Helix results, checked', async () => {
    // Helix no longer returns "carol" (she went offline), but the user is
    // already comparing with her — the dropdown should still show her as
    // checked so deselection is discoverable.
    getStreamsByCategory.mockResolvedValue([helixStream('alice', 'Alice')])

    render(
      <StreamSelector
        gameId="g1"
        currentLogin="broadcaster"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        initialSelected={[
          { login: 'carol', displayName: 'Carol', broadcasterId: 'uid_carol' },
        ]}
      />,
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Select Carol')).toBeChecked(),
    )
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.getByText(/current selection/i)).toBeInTheDocument()
  })

  it('renders the empty-state message when the Helix response is empty after filtering', async () => {
    getStreamsByCategory.mockResolvedValue([
      helixStream('broadcaster', 'Broadcaster'),
    ])

    render(
      <StreamSelector
        gameId="g1"
        currentLogin="broadcaster"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText(/no other streams live/i)).toBeInTheDocument(),
    )
  })
})
