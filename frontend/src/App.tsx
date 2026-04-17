import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useChatStore } from './store/chatStore'
import { AuthCallback } from './features/auth/AuthCallback'
import { ConnectForm } from './features/auth/ConnectForm'

// TODO(phase-3): Ctrl+Shift+P global keydown listener → perfStore.toggleVisibility
// (lives here because PerfOverlay lands alongside it in phase 3).

const LandingView = () => {
  const session = useChatStore((s) => s.session)

  if (!session) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <div className="absolute top-10 left-10 font-mono text-[10px] uppercase tracking-[0.4em] text-ink-500">
          twitch · chat · lab
        </div>
        <div className="absolute bottom-10 right-10 font-mono text-[10px] uppercase tracking-[0.4em] text-ink-500">
          phase 01 · foundation
        </div>
        <ConnectForm />
      </div>
    )
  }

  return (
    <div className="min-h-screen p-10">
      <div className="grain relative border border-ink-700 bg-ink-900/50 p-8">
        <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-ember-500">
          Connected
        </div>
        <h1 className="font-display text-4xl font-light text-ink-100">
          {session.broadcasterDisplayName}
        </h1>
        <p className="mt-2 font-mono text-sm text-ink-300">
          {session.streamTitle || '— stream offline —'}
        </p>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-500">
          Open DevTools → check <span className="text-ember-500">useChatStore.getState().messages</span> as chat arrives.
        </p>
      </div>
    </div>
  )
}

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<LandingView />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
)
