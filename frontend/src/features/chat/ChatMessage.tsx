import { memo } from 'react'
import type { ChatMessage as ChatMessageData } from '../../types/twitch'
import { BadgeIcon } from './BadgeIcon'
import { EmoteText } from './EmoteText'

interface ChatMessageProps {
  message: ChatMessageData
}

const BASE_CLASS = 'flex items-baseline gap-1 px-3 py-0.5 text-sm leading-tight'

function ChatMessageInner({ message }: ChatMessageProps): JSX.Element {
  const className = [
    BASE_CLASS,
    message.isFirstInSession ? 'bg-ember-500/10 border-l-2 border-ember-400' : '',
    message.isHighlighted ? 'bg-ink-700/40' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      {message.badges.map((badge) => (
        <BadgeIcon key={`${badge.setId}:${badge.id}`} badge={badge} />
      ))}
      <span className="font-semibold" style={{ color: message.color || '#a1a1aa' }}>
        {message.displayName}
      </span>
      <span className="text-ink-500 mr-1">:</span>
      <EmoteText fragments={message.fragments} />
    </div>
  )
}

export const ChatMessage = memo(
  ChatMessageInner,
  (prev, next) => prev.message.id === next.message.id,
)
