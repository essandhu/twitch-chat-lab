import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecorderControls } from './RecorderControls'
import { sessionRecorder, sessionReplayer } from '../auth/authServices'
import { useChatStore } from '../../store/chatStore'
import type { StreamSession } from '../../types/twitch'

const fireHotkey = () => {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true }),
    )
  })
}

const makeSession = (overrides: Partial<StreamSession> = {}): StreamSession => ({
  broadcasterId: 'b1',
  broadcasterLogin: 'testchannel',
  broadcasterDisplayName: 'TestChannel',
  streamTitle: '',
  gameName: '',
  gameId: '',
  viewerCount: 0,
  startedAt: new Date(),
  isConnected: true,
  ...overrides,
})

describe('RecorderControls', () => {
  beforeEach(() => {
    // Ensure recorder is stopped and buffer cleared before each test.
    sessionRecorder.stop()
    sessionRecorder.clear()
    sessionRecorder.setHashBroadcasterId(false)
    useChatStore.setState({ session: null })
  })

  afterEach(() => {
    sessionRecorder.stop()
    sessionRecorder.clear()
    sessionRecorder.setHashBroadcasterId(false)
    useChatStore.setState({ session: null })
    vi.restoreAllMocks()
  })

  it('is hidden by default and revealed by Ctrl+Shift+R', () => {
    render(<RecorderControls />)
    expect(screen.queryByTestId('recorder-controls')).toBeNull()
    fireHotkey()
    expect(screen.getByTestId('recorder-controls')).toBeInTheDocument()
  })

  it('Ctrl+Shift+R toggles visibility off again', () => {
    render(<RecorderControls />)
    fireHotkey()
    expect(screen.getByTestId('recorder-controls')).toBeInTheDocument()
    fireHotkey()
    expect(screen.queryByTestId('recorder-controls')).toBeNull()
  })

  it('Start button calls sessionRecorder.start and is disabled while recording', () => {
    const startSpy = vi.spyOn(sessionRecorder, 'start')
    render(<RecorderControls />)
    fireHotkey()
    const startBtn = screen.getByTestId('recorder-start') as HTMLButtonElement
    expect(startBtn.disabled).toBe(false)
    fireEvent.click(startBtn)
    expect(startSpy).toHaveBeenCalledTimes(1)
    // After start, button should be disabled (isRecording is now true).
    expect(
      (screen.getByTestId('recorder-start') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('Stop button is disabled when not recording and enabled once recording', () => {
    const stopSpy = vi.spyOn(sessionRecorder, 'stop')
    render(<RecorderControls />)
    fireHotkey()
    const stopBtn = screen.getByTestId('recorder-stop') as HTMLButtonElement
    expect(stopBtn.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('recorder-start'))
    const stopBtn2 = screen.getByTestId('recorder-stop') as HTMLButtonElement
    expect(stopBtn2.disabled).toBe(false)
    fireEvent.click(stopBtn2)
    expect(stopSpy).toHaveBeenCalledTimes(1)
  })

  it('hash toggle reads from and writes to sessionRecorder', () => {
    const setSpy = vi.spyOn(sessionRecorder, 'setHashBroadcasterId')
    render(<RecorderControls />)
    fireHotkey()
    const toggle = screen.getByTestId('recorder-hash-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(setSpy).toHaveBeenCalledWith(true)
    expect(sessionRecorder.getHashBroadcasterId()).toBe(true)
    expect(
      (screen.getByTestId('recorder-hash-toggle') as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('download is disabled when buffer is empty', () => {
    render(<RecorderControls />)
    fireHotkey()
    const dl = screen.getByTestId('recorder-download') as HTMLButtonElement
    expect(dl.disabled).toBe(true)
  })

  it('download reveals privacy warning banner with broadcaster-hash state', () => {
    useChatStore.setState({ session: makeSession() })
    vi.spyOn(sessionRecorder, 'hasFrames').mockReturnValue(true)
    render(<RecorderControls />)
    fireHotkey()
    const dl = screen.getByTestId('recorder-download') as HTMLButtonElement
    expect(dl.disabled).toBe(false)
    fireEvent.click(dl)
    const banner = screen.getByTestId('recorder-download-warning')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent(
      'Recording contains chat messages from other users; distribute locally only.',
    )
    // Hash toggle state surfaced on banner.
    expect(banner).toHaveTextContent(/hash/i)
  })

  it('confirm-download calls sessionRecorder.download with chat login', () => {
    useChatStore.setState({ session: makeSession({ broadcasterLogin: 'foo' }) })
    vi.spyOn(sessionRecorder, 'hasFrames').mockReturnValue(true)
    const dlSpy = vi.spyOn(sessionRecorder, 'download').mockImplementation(() => {})
    render(<RecorderControls />)
    fireHotkey()
    fireEvent.click(screen.getByTestId('recorder-download'))
    const confirm = screen.getByRole('button', { name: /confirm & download/i })
    fireEvent.click(confirm)
    expect(dlSpy).toHaveBeenCalledWith('foo')
  })

  it('Import triggers sessionReplayer.load on file selection', async () => {
    const loadSpy = vi.spyOn(sessionReplayer, 'load').mockResolvedValue({
      header: { schemaVersion: 1, recordedAt: '2026-01-01T00:00:00.000Z', recorderVersion: '0.11.0' },
      frameCount: 0,
      duration: 0,
      streamLogins: [],
    })
    // Stub reload so the test page does not attempt to navigate.
    const reloadStub = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadStub, search: '' },
    })
    render(<RecorderControls />)
    fireHotkey()
    const importInput = screen.getByTestId('recorder-import') as HTMLInputElement
    const file = new File(['{}\n'], 'demo.jsonl', { type: 'application/x-ndjson' })
    await act(async () => {
      fireEvent.change(importInput, { target: { files: [file] } })
      // flush load() promise microtask
      await Promise.resolve()
    })
    expect(loadSpy).toHaveBeenCalledWith(file)
  })
})
