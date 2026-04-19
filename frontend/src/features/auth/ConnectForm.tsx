import { useState, type FormEvent } from 'react'
import { twitchAuthService } from './authServices'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

export const PENDING_CHANNEL_KEY = 'twitch_pending_channel'

export const ConnectForm = () => {
  const [channel, setChannel] = useState('')

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = channel.trim().toLowerCase()
    if (trimmed) {
      sessionStorage.setItem(PENDING_CHANNEL_KEY, trimmed)
    }
    twitchAuthService.authorize()
  }

  return (
    <Card className="max-w-md w-full">
      <Card.Body className="flex flex-col items-center gap-4 text-center p-8">
        <h2 className="text-lg font-semibold text-text">
          Sign in to Twitch Chat Lab
        </h2>
        <p className="text-sm text-text-muted">
          Connect your Twitch account to analyze any channel&apos;s chat stream in real time.
        </p>
        <form
          onSubmit={onSubmit}
          className="flex flex-col items-stretch gap-3 w-full"
        >
          <Input
            aria-label="Twitch channel login"
            placeholder="Channel login (optional)"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" size="lg">
            Sign in with Twitch
          </Button>
        </form>
      </Card.Body>
    </Card>
  )
}
