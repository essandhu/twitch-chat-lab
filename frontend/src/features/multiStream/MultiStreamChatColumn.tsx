import { useEffect, useState } from 'react'
import { ChatList } from '../chat/ChatList'
import { useMultiStreamStore, useStreamSlice } from '../../store/multiStreamStore'
import { Card } from '../../components/ui/Card'
import { IconButton } from '../../components/ui/IconButton'
import { Avatar } from '../../components/ui/Avatar'

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
  const initial = slice.displayName.charAt(0).toUpperCase()

  return (
    <Card className="relative flex h-full min-h-0 flex-col rounded-none">
      <Card.Header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar.Root className="h-6 w-6 flex-shrink-0">
            {slice.profileImageUrl ? (
              <Avatar.Image src={slice.profileImageUrl} alt={slice.displayName} />
            ) : null}
            <Avatar.Fallback delayMs={slice.profileImageUrl ? 400 : 0}>
              {initial}
            </Avatar.Fallback>
          </Avatar.Root>
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
              slice.isDegraded ? 'bg-surface-hover' : 'bg-success'
            }`}
          />
          <span className="font-semibold text-sm text-text truncate">
            {slice.displayName}
          </span>
        </div>
        <IconButton
          size="sm"
          tooltip="Remove stream"
          aria-label={`Close ${slice.displayName} stream`}
          onClick={handleClose}
        >
          ×
        </IconButton>
      </Card.Header>

      {showBanner && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-warning/60 bg-warning/10 px-3 py-1.5 text-xs text-warning"
        >
          <span>Connection lost — close and re-add to retry</span>
          <IconButton
            size="sm"
            aria-label="Dismiss connection lost banner"
            onClick={() => setBannerDismissed(true)}
            className="text-warning hover:text-warning"
          >
            ×
          </IconButton>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ChatList messagesOverride={slice.messages} />
      </div>
    </Card>
  )
}
