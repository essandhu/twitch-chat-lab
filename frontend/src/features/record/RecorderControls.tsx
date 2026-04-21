import { useCallback, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { sessionRecorder, sessionReplayer } from '../auth/authServices'
import { useChatStore } from '../../store/chatStore'
import { isReplayMode } from './replayBoot'
import { useRecorderToggle } from './recorderKeybinding'

const PRIVACY_COPY =
  'Recording contains chat messages from other users; distribute locally only.'
const HASH_COPY =
  'Hash broadcaster ID before writing (recommended for shared recordings).'

const triggerReplayReload = () => {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('replay')) {
    params.set('replay', '1')
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?${params.toString()}`,
    )
  }
  window.location.reload()
}

export const RecorderControls = () => {
  const [open, setOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(sessionRecorder.isRecording)
  const [hasFrames, setHasFrames] = useState(sessionRecorder.hasFrames())
  const [hashId, setHashId] = useState(sessionRecorder.getHashBroadcasterId())
  const [showWarn, setShowWarn] = useState(false)

  useRecorderToggle(useCallback(() => setOpen((v) => !v), []))

  const replayActive = isReplayMode()
  const sync = () => {
    setIsRecording(sessionRecorder.isRecording)
    setHasFrames(sessionRecorder.hasFrames())
  }

  const onConfirmDownload = () => {
    sessionRecorder.download(useChatStore.getState().session?.broadcasterLogin)
    setShowWarn(false)
  }

  const onHashToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    sessionRecorder.setHashBroadcasterId(e.target.checked)
    setHashId(sessionRecorder.getHashBroadcasterId())
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await sessionReplayer.load(file)
    triggerReplayReload()
  }

  if (!open) return null

  return (
    <div
      data-testid="recorder-controls"
      role="region"
      aria-label="Session recorder"
      className="fixed bottom-4 left-4 z-[9999] w-80 rounded-lg border border-border bg-surface-raised text-text shadow-xl backdrop-blur px-4 py-3 font-mono"
    >
      <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-text-muted">
        recorder
      </div>
      <div className="flex gap-2 mb-3">
        <Button
          data-testid="recorder-start" size="sm" variant="primary"
          disabled={isRecording || replayActive}
          onClick={() => { sessionRecorder.start(); sync() }}
        >Start</Button>
        <Button
          data-testid="recorder-stop" size="sm" variant="secondary"
          disabled={!isRecording}
          onClick={() => { sessionRecorder.stop(); sync() }}
        >Stop</Button>
        <Button
          data-testid="recorder-download" size="sm" variant="secondary"
          disabled={!hasFrames} onClick={() => setShowWarn(true)}
        >Download</Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-text mb-2">
        <input
          data-testid="recorder-hash-toggle" type="checkbox"
          checked={hashId} onChange={onHashToggle} className="accent-accent"
        />
        <span>{HASH_COPY}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-text">
        <span className="text-text-muted">Import:</span>
        <input
          data-testid="recorder-import" type="file" accept=".jsonl"
          onChange={onFileChange} className="text-xs"
        />
      </label>
      {showWarn && (
        <div
          data-testid="recorder-download-warning"
          className="mt-3 rounded border border-warning/50 bg-warning/10 p-2 text-xs text-text"
        >
          <p className="mb-2">{PRIVACY_COPY}</p>
          <p className="mb-2 text-text-muted">
            Hash broadcaster ID: {hashId ? 'ON' : 'OFF'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={onConfirmDownload}>
              Confirm &amp; download
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowWarn(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
