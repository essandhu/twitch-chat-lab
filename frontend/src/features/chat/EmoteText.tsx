import { memo } from 'react'
import type { MessageFragment } from '../../types/twitch'

const emoteUrl = (id: string): string =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`

interface EmoteTextProps {
  fragments: MessageFragment[]
}

function EmoteTextImpl({ fragments }: EmoteTextProps) {
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
        return (
          <span key={index} className="whitespace-pre-wrap">
            {fragment.text}
          </span>
        )
      })}
    </>
  )
}

export const EmoteText = memo(EmoteTextImpl)
