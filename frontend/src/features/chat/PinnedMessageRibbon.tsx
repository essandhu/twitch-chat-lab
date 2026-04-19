import { useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import type { PinnedMessage } from '../../types/twitch'

const MAX_VISIBLE = 3
const MAX_CHIP_CHARS = 80

const truncate = (text: string): string =>
  text.length > MAX_CHIP_CHARS ? `${text.slice(0, MAX_CHIP_CHARS)}…` : text

interface PinChipProps {
  pin: PinnedMessage
}

function PinChip({ pin }: PinChipProps) {
  return (
    <div
      data-testid="pinned-chip"
      className="flex items-center gap-2 px-2 py-1 bg-ink-800/70 border-l-2 border-ember-400 rounded-sm max-w-xs min-w-0"
    >
      <span aria-hidden="true" className="text-ember-400">
        📌
      </span>
      <span className="text-xs font-semibold text-ink-100 whitespace-nowrap">{pin.userName}</span>
      <span className="text-xs text-ink-300 truncate">{truncate(pin.text)}</span>
    </div>
  )
}

export function PinnedMessageRibbon(): JSX.Element | null {
  const pinnedMessages = useChatStore((s) => s.pinnedMessages)
  const [expanded, setExpanded] = useState(false)

  if (pinnedMessages.length === 0) return null

  const visible = pinnedMessages.slice(0, MAX_VISIBLE)
  const overflow = pinnedMessages.slice(MAX_VISIBLE)

  return (
    <div
      data-testid="pinned-ribbon"
      className="relative sticky top-0 z-10 border-b border-ink-800 bg-ink-900/90 backdrop-blur"
    >
      <div className="flex items-center gap-2 px-2 py-1 overflow-x-auto">
        {visible.map((pin) => (
          <PinChip key={pin.id} pin={pin} />
        ))}
        {overflow.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="px-2 py-1 text-xs text-ember-400 hover:text-ember-500 whitespace-nowrap"
          >
            +{overflow.length} more
          </button>
        ) : null}
      </div>
      {expanded && overflow.length > 0 ? (
        <div className="flex flex-col gap-1 px-2 pb-2">
          {overflow.map((pin) => (
            <PinChip key={pin.id} pin={pin} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
