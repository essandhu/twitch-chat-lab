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
      <span className="block px-3 pt-1 text-xs italic text-ink-500">{UNAVAILABLE_LABEL}</span>
    )
  }

  const preview = truncate(reply.parentMessageText)
  return (
    <button
      type="button"
      onClick={() => onScrollToParent?.(reply.parentMessageId)}
      className="block w-full text-left px-3 pt-1 text-xs text-ink-300 hover:text-ink-100 focus:outline-none focus:text-ink-100 truncate"
    >
      Replying to <span className="font-semibold">@{reply.parentUserName}</span>
      <span className="text-ink-500">: {preview}</span>
    </button>
  )
}

export const ReplyHeader = memo(ReplyHeaderInner)
