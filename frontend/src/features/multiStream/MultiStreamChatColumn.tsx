import { useEffect, useMemo, useState } from 'react'
import { ChatList } from '../chat/ChatList'
import { useMultiStreamStore, useStreamSlice, DEFAULT_FILTER_STATE } from '../../store/multiStreamStore'
import { Card } from '../../components/ui/Card'
import { IconButton } from '../../components/ui/IconButton'
import { Avatar } from '../../components/ui/Avatar'
import { FilterToolbar } from '../filters/FilterToolbar'
import { applyFilters } from '../filters/filterLogic'
import { isDuringSpikeFor } from './derivedIsDuringSpike'
import { useIntelligenceStore } from '../../store/intelligenceStore'
import { RaidRiskChip } from '../intelligence/RaidRiskChip'

interface MultiStreamChatColumnProps {
  streamLogin: string
}

export function MultiStreamChatColumn({ streamLogin }: MultiStreamChatColumnProps): JSX.Element | null {
  const slice = useStreamSlice(streamLogin)
  const filterState = useMultiStreamStore((s) => s.filterState[streamLogin]) ?? DEFAULT_FILTER_STATE
  const setStreamFilter = useMultiStreamStore((s) => s.setStreamFilter)
  const applyFilterToAllStreams = useMultiStreamStore((s) => s.applyFilterToAllStreams)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const filteredMessages = useMemo(() => {
    if (!slice) return []
    const spikeFn = isDuringSpikeFor(slice.dataPoints)
    const riskBandFor = () =>
      useIntelligenceStore.getState().slices[streamLogin]?.raidBand ?? 'calm'
    return applyFilters(slice.messages, filterState, spikeFn, riskBandFor)
  }, [slice, filterState, streamLogin])

  // Re-show banner on fresh transition out of degraded state.
  useEffect(() => {
    if (slice && slice.connectionState !== 'degraded') {
      setBannerDismissed(false)
    }
  }, [slice?.connectionState])

  if (!slice) return null

  const handleClose = () => {
    useMultiStreamStore.getState().removeStream(streamLogin)
  }

  const isConnecting = slice.connectionState === 'connecting'
  const isDegraded = slice.connectionState === 'degraded'
  const showBanner = isDegraded && !bannerDismissed
  // Hide the spinner once any message has landed, even if the store hasn't
  // flipped us to 'ready' yet (e.g., annotations-first frames). Users don't
  // want to see a spinner sitting above already-visible chat.
  const showConnectingPlaceholder = isConnecting && slice.messages.length === 0
  const initial = slice.displayName.charAt(0).toUpperCase()

  const statusDotClass = isDegraded
    ? 'bg-surface-hover'
    : isConnecting
    ? 'bg-warning animate-pulse'
    : 'bg-success'

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
            className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${statusDotClass}`}
          />
          <span className="font-semibold text-sm text-text truncate">
            {slice.displayName}
          </span>
          <RaidRiskChip streamLogin={streamLogin} compact />
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

      <div className="border-b border-border px-2 py-1">
        <FilterToolbar
          mode="multi"
          filterState={filterState}
          onFilterStateChange={(next) => setStreamFilter(streamLogin, next)}
          onApplyToAllStreams={applyFilterToAllStreams}
        />
      </div>

      <div className="flex-1 min-h-0">
        {showConnectingPlaceholder ? (
          <div
            role="status"
            aria-live="polite"
            aria-label={`Connecting to ${slice.displayName}`}
            className="flex h-full items-center justify-center px-4"
          >
            <div className="flex flex-col items-center gap-3 text-text-muted">
              <span
                aria-hidden="true"
                className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
              />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em]">
                connecting&hellip;
              </span>
            </div>
          </div>
        ) : (
          <ChatList messagesOverride={filteredMessages} />
        )}
      </div>
    </Card>
  )
}
