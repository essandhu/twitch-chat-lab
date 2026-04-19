import { memo, useContext } from 'react'
import type { ChatMessage as ChatMessageData } from '../../types/twitch'
import { BadgeIcon } from './BadgeIcon'
import { ChatScrollContext } from './chatScrollContext'
import { CheerPill, cheerTierColor } from './CheerPill'
import { EmoteText } from './EmoteText'
import { ReplyHeader } from './ReplyHeader'

interface ChatMessageProps {
  message: ChatMessageData
}

const BASE_CLASS = 'flex items-baseline gap-1 px-3 py-0.5 text-sm leading-tight'

const variantClass = (messageType: string, isHighlighted: boolean): string => {
  if (isHighlighted) return 'bg-surface-hover/40'
  if (messageType === 'channel_points_highlighted') return 'bg-surface-hover/40'
  if (messageType === 'channel_points_sub_only') return 'border-l-2 border-accent/50'
  if (messageType === 'user_intro') return 'bg-accent/5'
  return ''
}

function IntroBadge() {
  return (
    <span className="px-1 py-0.5 text-[10px] font-semibold rounded bg-accent/20 text-accent">
      👋 intro
    </span>
  )
}

function ChatMessageInner({ message }: ChatMessageProps): JSX.Element {
  const onScrollToParent = useContext(ChatScrollContext)

  const className = [
    BASE_CLASS,
    message.isFirstInSession ? 'bg-accent/10 border-l-2 border-accent' : '',
    variantClass(message.messageType, message.isHighlighted),
  ]
    .filter(Boolean)
    .join(' ')

  const cheerColor = message.cheer ? cheerTierColor(message.cheer.bits) : undefined

  const body = (
    <>
      {message.badges.map((badge) => (
        <BadgeIcon key={`${badge.setId}:${badge.id}`} badge={badge} />
      ))}
      {message.messageType === 'user_intro' ? <IntroBadge /> : null}
      <span
        className={message.color ? 'font-semibold' : 'font-semibold text-text-muted'}
        style={message.color ? { color: message.color } : undefined}
      >
        {message.displayName}
      </span>
      <span className="text-text-muted mr-1">:</span>
      {message.cheer ? <CheerPill bits={message.cheer.bits} /> : null}
      <EmoteText fragments={message.fragments} cheerTierColor={cheerColor} />
    </>
  )

  if (!message.reply) {
    return <div className={className}>{body}</div>
  }

  return (
    <div className={className}>
      <div className="w-full">
        <ReplyHeader reply={message.reply} onScrollToParent={onScrollToParent} />
        <div className="flex items-baseline gap-1">{body}</div>
      </div>
    </div>
  )
}

export const ChatMessage = memo(
  ChatMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.reply?.parentMessageId === next.message.reply?.parentMessageId &&
    prev.message.cheer?.bits === next.message.cheer?.bits &&
    prev.message.messageType === next.message.messageType,
)
