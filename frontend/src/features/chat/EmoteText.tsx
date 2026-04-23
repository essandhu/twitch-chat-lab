import { memo } from 'react'
import type { MessageFragment } from '../../types/twitch'
import { useSafeMode } from '../../hooks/useSafeMode'
import { censorText } from '../../lib/profanityFilter'

const emoteUrl = (id: string): string =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`

interface EmoteTextProps {
  fragments: MessageFragment[]
  cheerTierColor?: string
}

function EmoteTextImpl({ fragments, cheerTierColor }: EmoteTextProps) {
  const { safeMode } = useSafeMode()
  return (
    <>
      {fragments.map((fragment, index) => {
        if (fragment.type === 'emote') {
          return (
            <img
              key={index}
              src={emoteUrl(fragment.emote.id)}
              alt={fragment.text}
              title={fragment.text}
              loading="lazy"
              className="inline-block align-middle h-7"
            />
          )
        }
        if (fragment.type === 'cheermote' && cheerTierColor) {
          return (
            <span
              key={index}
              className="whitespace-pre-wrap font-semibold"
              style={{ color: cheerTierColor }}
            >
              {fragment.text}
            </span>
          )
        }
        return (
          <span key={index} className="whitespace-pre-wrap">
            {censorText(fragment.text, safeMode)}
          </span>
        )
      })}
    </>
  )
}

export const EmoteText = memo(EmoteTextImpl)
