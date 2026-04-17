import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useChatStore } from './store/chatStore'
import { AuthCallback } from './features/auth/AuthCallback'
import { ConnectForm } from './features/auth/ConnectForm'
import { StreamHeader } from './components/StreamHeader'
import { TabBar } from './components/TabBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ChatPanel } from './features/chat/ChatPanel'
import { FirstTimerPanel } from './features/firstTimers/FirstTimerPanel'

// TODO(phase-3): Ctrl+Shift+P global keydown listener → perfStore.toggleVisibility
// (lives here because PerfOverlay lands alongside it in phase 3).
// TODO(phase-3): center heatmap panel column in <main>
// TODO(phase-4): right multi-stream panel column in <main>

const LandingView = () => {
  const session = useChatStore((s) => s.session)
  const firstTimerCount = useChatStore((s) => s.firstTimers.length)
  const [activeTabId, setActiveTabId] = useState<'chat' | 'firstTimers'>('chat')

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

  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'firstTimers', label: 'First-Timers', badgeCount: firstTimerCount },
  ]

  return (
    <div className="flex h-screen flex-col">
      <ErrorBoundary label="Stream header">
        <StreamHeader />
      </ErrorBoundary>
      <main className="flex-1 min-h-0 grid grid-cols-1 gap-4 p-4">
        <section className="flex flex-col min-h-0 border border-ink-800 bg-ink-900/40">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabChange={(id) => setActiveTabId(id as 'chat' | 'firstTimers')}
          />
          <div className="flex-1 min-h-0">
            {activeTabId === 'chat' ? (
              <ErrorBoundary label="Chat">
                <ChatPanel />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary label="First-timers">
                <FirstTimerPanel />
              </ErrorBoundary>
            )}
          </div>
        </section>
      </main>
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
