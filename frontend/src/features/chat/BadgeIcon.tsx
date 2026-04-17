import { memo } from 'react'
import type { Badge } from '../../types/twitch'
import { useChatStore } from '../../store/chatStore'

interface BadgeIconProps {
  badge: Badge
}

function BadgeIconInner({ badge }: BadgeIconProps): JSX.Element {
  const badgeDefinitions = useChatStore((s) => s.badgeDefinitions)
  const url = badgeDefinitions[badge.setId]?.[badge.id]

  if (!url) {
    return (
      <span
        title={badge.setId}
        className="inline-block mr-1 align-middle h-[18px] w-[18px] rounded-sm bg-ink-700"
      />
    )
  }

  return (
    <img
      src={url}
      alt={badge.setId}
      title={badge.setId}
      width={18}
      height={18}
      loading="lazy"
      className="inline-block mr-1 align-middle"
    />
  )
}

export const BadgeIcon = memo(BadgeIconInner)
