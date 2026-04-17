import { useState, type FormEvent } from 'react'
import { twitchAuthService } from './authServices'

export const PENDING_CHANNEL_KEY = 'twitch_pending_channel'

export const ConnectForm = () => {
  const [channel, setChannel] = useState('')

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = channel.trim().toLowerCase()
    if (!trimmed) return
    sessionStorage.setItem(PENDING_CHANNEL_KEY, trimmed)
    twitchAuthService.authorize()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative grain flex flex-col gap-6 border border-ink-700 bg-ink-900/60 p-8 w-[min(28rem,100%)] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-center gap-3 text-ember-500 font-mono text-xs tracking-[0.3em]">
        <span className="h-px flex-1 bg-ember-500/40" />
        <span>SESSION / INIT</span>
        <span className="h-px flex-1 bg-ember-500/40" />
      </div>
      <label className="flex flex-col gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-300">
          Channel
        </span>
        <div className="flex items-center border border-ink-700 bg-ink-950 focus-within:border-ember-500/70">
          <span className="px-3 font-mono text-ember-500">&gt;</span>
          <input
            aria-label="Twitch channel login"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="streamer_login"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent py-3 pr-3 font-mono text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
        </div>
      </label>
      <button
        type="submit"
        disabled={channel.trim().length === 0}
        className="group flex items-center justify-between border border-ember-500 bg-ember-500/10 px-4 py-3 font-mono text-xs uppercase tracking-[0.3em] text-ember-500 transition-colors hover:bg-ember-500 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ember-500/10 disabled:hover:text-ember-500"
      >
        <span>Authenticate via Twitch</span>
        <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
      </button>
    </form>
  )
}
