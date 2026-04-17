import { useEffect, useState } from 'react'
import { ChatList } from '../chat/ChatList'
import { useMultiStreamStore, useStreamSlice } from '../../store/multiStreamStore'

interface MultiStreamChatColumnProps {
  streamLogin: string
}

export function MultiStreamChatColumn({ streamLogin }: MultiStreamChatColumnProps): JSX.Element | null {
  const slice = useStreamSlice(streamLogin)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Re-show banner on fresh transition into degraded state.
  useEffect(() => {
    if (slice?.isDegraded === false) {
      setBannerDismissed(false)
    }
  }, [slice?.isDegraded])

  if (!slice) return null

  const handleClose = () => {
    useMultiStreamStore.getState().removeStream(streamLogin)
  }

  const showBanner = slice.isDegraded && !bannerDismissed

  return (
    <div className="relative flex h-full min-h-0 flex-col border border-ink-800 bg-ink-900/40">
      <div className="border-b border-ink-800 bg-ink-900/40 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-ink-200">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${
              slice.isDegraded ? 'bg-ink-600' : 'bg-ember-500'
            }`}
          />
          <span className="font-display text-sm text-ink-100">{slice.displayName}</span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label={`Close ${slice.displayName} stream`}
          className="text-ink-500 hover:text-ink-100 font-mono text-sm px-1"
        >
          ×
        </button>
      </div>

      {showBanner && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-ember-500/60 bg-ember-500/10 px-3 py-1.5 font-mono text-[11px] text-ember-400"
        >
          <span>Connection lost — close and re-add to retry</span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss connection lost banner"
            className="text-ember-400 hover:text-ember-300 px-1"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ChatList messagesOverride={slice.messages} />
      </div>
    </div>
  )
}
