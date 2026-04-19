import { memo } from 'react'
import type { ChatRow } from '../../types/twitch'
import { ChatMessage } from './ChatMessage'
import { DeletionMarker } from './DeletionMarker'
import { SystemEventRow } from './SystemEventRow'

interface ChatRowRendererProps {
  row: ChatRow
}

function ChatRowRendererInner({ row }: ChatRowRendererProps): JSX.Element {
  if (row.kind === 'message') return <ChatMessage message={row.message} />
  if (row.kind === 'system') return <SystemEventRow event={row.event} />
  if (row.kind === 'deletion') return <DeletionMarker />
  return (
    <div className="px-3 py-0.5 text-xs italic text-text-muted leading-tight">
      Chat cleared by a moderator
    </div>
  )
}

export const ChatRowRenderer = memo(
  ChatRowRendererInner,
  (prev, next) => prev.row.id === next.row.id,
)
