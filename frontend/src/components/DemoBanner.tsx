interface DemoBannerProps {
  onSignIn: () => void
}

export const DemoBanner = ({ onSignIn }: DemoBannerProps) => (
  <div
    role="status"
    aria-label="Demo mode"
    className="sticky top-0 z-40 flex h-10 items-center justify-center gap-3 border-b border-ember-500/40 bg-ember-500/10 px-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ember-200"
  >
    <span className="text-ember-500">●</span>
    <span>Read-only demo mode</span>
    <span className="hidden text-ink-300 sm:inline">
      — chat is live but you cannot send messages or change channels.
    </span>
    <button
      type="button"
      onClick={onSignIn}
      className="ml-1 border border-ember-500/60 px-2 py-0.5 text-ember-500 transition-colors hover:bg-ember-500 hover:text-ink-950"
    >
      Sign in with Twitch
    </button>
  </div>
)
