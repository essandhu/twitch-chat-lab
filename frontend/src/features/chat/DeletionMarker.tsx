import { memo } from 'react'

interface DeletionMarkerProps {
  reason?: 'deleted' | 'user-cleared'
}

function DeletionMarkerInner({ reason: _reason = 'deleted' }: DeletionMarkerProps) {
  return (
    <div
      role="status"
      data-row-role="deletion-marker"
      className="px-3 py-0.5 text-xs italic text-text-muted leading-tight"
    >
      Message removed by moderator
    </div>
  )
}

export const DeletionMarker = memo(DeletionMarkerInner)
