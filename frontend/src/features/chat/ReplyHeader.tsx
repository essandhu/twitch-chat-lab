import { memo } from 'react'
import { useChatStore } from '../../store/chatStore'
import type { ChatMessageReply } from '../../types/twitch'

const MAX_PREVIEW_CHARS = 60

const truncate = (text: string): string =>
  text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text

const UNAVAILABLE_LABEL = '[original message no longer available]'

interface ReplyHeaderProps {
  reply: ChatMessageReply
  onScrollToParent?: (parentMessageId: string) => void
}

function ReplyHeaderInner({ reply, onScrollToParent }: ReplyHeaderProps) {
  const parent = useChatStore((s) => s.messagesById[reply.parentMessageId])

  if (!parent) {
    return (
      <span className="block px-3 pt-1 text-xs italic text-text-muted">{UNAVAILABLE_LABEL}</span>
    )
  }

  const preview = truncate(reply.parentMessageText)
  return (
    <button
      type="button"
      onClick={() => onScrollToParent?.(reply.parentMessageId)}
      className="block w-full text-left px-3 pt-1 text-xs text-text-muted hover:text-accent focus:outline-none focus:text-accent truncate"
    >
      Replying to <span className="font-semibold">@{reply.parentUserName}</span>
      <span className="text-text-muted">: {preview}</span>
    </button>
  )
}

export const ReplyHeader = memo(ReplyHeaderInner)
