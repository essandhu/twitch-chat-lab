import { memo } from 'react'
import type { AnnouncementColor, SubTier, SystemEvent } from '../../types/twitch'

const ROW_CLASS =
  'flex items-center gap-2 px-3 py-1 bg-ink-800/60 text-ink-100 text-sm leading-tight'

const PILL_CLASS =
  'inline-flex items-center px-1.5 py-0.5 rounded-full bg-ink-700 text-xs text-ink-300'

const tierLabel = (tier: SubTier): string => {
  if (tier === '3000') return '3'
  if (tier === '2000') return '2'
  return '1'
}

const ANNOUNCEMENT_COLORS: Record<AnnouncementColor, string> = {
  PRIMARY: '#f5a524', // ember-500 (project accent)
  BLUE: '#3B82F6',
  GREEN: '#10B981',
  ORANGE: '#F59E0B',
  PURPLE: '#8B5CF6',
}

function renderByKind(event: SystemEvent): JSX.Element {
  switch (event.noticeType) {
    case 'sub':
      return (
        <>
          <span aria-hidden="true">★</span>
          <span>
            <span className="font-semibold">{event.userName}</span> subscribed at Tier{' '}
            {tierLabel(event.tier)}
          </span>
          <span className={PILL_CLASS}>{event.cumulativeMonths}mo</span>
        </>
      )
    case 'resub':
      return (
        <>
          <span aria-hidden="true">★</span>
          <span>
            <span className="font-semibold">{event.userName}</span> resubscribed at Tier{' '}
            {tierLabel(event.tier)}
          </span>
          <span className={PILL_CLASS}>{event.cumulativeMonths}mo</span>
          {event.streakMonths !== null ? (
            <span className={PILL_CLASS}>🔥 {event.streakMonths}</span>
          ) : null}
        </>
      )
    case 'gift-sub': {
      const verb = event.total > 1 ? 'subs' : 'sub'
      const who = event.isAnonymous ? 'An anonymous gifter' : event.fromUserName
      return (
        <>
          <span aria-hidden="true">🎁</span>
          <span>
            <span className="font-semibold">{who}</span> gifted {event.total} Tier{' '}
            {tierLabel(event.tier)} {verb}
          </span>
        </>
      )
    }
    case 'raid':
      return (
        <>
          <span aria-hidden="true">⚔</span>
          <span>
            <span className="font-semibold">{event.fromUserName}</span> raided with {event.viewers}{' '}
            viewer{event.viewers === 1 ? '' : 's'}
          </span>
        </>
      )
    case 'announcement':
      return (
        <>
          <span
            data-announcement-color={event.color}
            aria-hidden="true"
            className="inline-block h-5 w-1 rounded-sm"
            style={{ backgroundColor: ANNOUNCEMENT_COLORS[event.color] }}
          />
          <span>
            <span className="font-semibold">{event.userName}</span>: {event.body}
          </span>
        </>
      )
    case 'bits-badge-tier':
      return (
        <>
          <span aria-hidden="true">◆</span>
          <span>
            <span className="font-semibold">{event.userName}</span> earned the {event.tier}-bits
            badge tier
          </span>
        </>
      )
    case 'charity-donation':
      return (
        <>
          <span aria-hidden="true">♥</span>
          <span>
            <span className="font-semibold">{event.userName}</span> donated {event.amount.value}{' '}
            {event.amount.currency} to charity
          </span>
        </>
      )
    case 'shared-chat-joined':
      return (
        <>
          <span aria-hidden="true">⇌</span>
          <span>
            <span className="font-semibold">{event.broadcasterUserName}</span>&apos;s channel
            joined shared chat
          </span>
        </>
      )
  }
}

interface SystemEventRowProps {
  event: SystemEvent
}

function SystemEventRowInner({ event }: SystemEventRowProps) {
  return <div className={ROW_CLASS}>{renderByKind(event)}</div>
}

export const SystemEventRow = memo(
  SystemEventRowInner,
  (prev, next) => prev.event === next.event,
)
