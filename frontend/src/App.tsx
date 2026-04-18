import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useChatStore } from './store/chatStore'
import { useMultiStreamStore } from './store/multiStreamStore'
import { usePerfStore } from './store/perfStore'
import { AuthCallback } from './features/auth/AuthCallback'
import { ConnectForm } from './features/auth/ConnectForm'
import { twitchAuthService } from './features/auth/authServices'
import { startDemoSession } from './features/auth/demoSession'
import { StreamHeader } from './components/StreamHeader'
import { TabBar } from './components/TabBar'
import { DemoBanner } from './components/DemoBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ChatPanel } from './features/chat/ChatPanel'
import { FirstTimerPanel } from './features/firstTimers/FirstTimerPanel'
import { HeatmapPanel } from './features/heatmap/HeatmapPanel'
import { MultiStreamLayout } from './features/multiStream/MultiStreamLayout'
import { PerfOverlay } from './features/perfPanel/PerfOverlay'
import { getDemoConfig, isDemoMode } from './services/DemoModeService'
import { logger } from './lib/logger'

const DemoMisconfigNotice = () => (
  <div className="mb-8 max-w-md border border-ember-500/40 bg-ink-900/70 p-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ember-500">
    Demo mode not configured — set VITE_DEMO_* in env.
  </div>
)

const DemoUnavailableNotice = () => (
  <div
    role="alert"
    className="mb-8 max-w-md border border-ember-500/40 bg-ink-900/70 p-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ember-500"
  >
    Demo unavailable — couldn't find a live channel. Try again in a moment.
  </div>
)

export const LandingView = () => {
  const session = useChatStore((s) => s.session)
  const firstTimerCount = useChatStore((s) => s.firstTimers.length)
  const isMultiActive = useMultiStreamStore((s) => s.isActive)
  const [activeTabId, setActiveTabId] = useState<'chat' | 'firstTimers'>('chat')

  const demoMode = isDemoMode()
  // Stable config reference per mount — DemoModeService is pure so re-reads are cheap
  // but we avoid re-running the effect on every render.
  const demoConfig = useMemo(() => (demoMode ? getDemoConfig() : null), [demoMode])
  const [demoFailed, setDemoFailed] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isP = e.key === 'P' || e.key === 'p'
      if (!isP || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      e.preventDefault()
      usePerfStore.getState().toggleVisibility()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!demoConfig) return
    let cancelled = false
    setDemoFailed(false)
    void startDemoSession(demoConfig).catch((err) => {
      if (cancelled) return
      logger.error('demo.connect_failed', { error: String(err) })
      setDemoFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [demoConfig])

  if (!session) {
    const demoConnecting = demoMode && demoConfig !== null && !demoFailed
    return (
      <div className="relative flex min-h-screen flex-col">
        {demoConnecting && (
          <DemoBanner onSignIn={() => twitchAuthService.authorize()} />
        )}
        <div className="relative flex flex-1 items-center justify-center px-6 py-12">
          <div className="absolute top-10 left-10 font-mono text-[10px] uppercase tracking-[0.4em] text-ink-500">
            twitch · chat · lab
          </div>
          <div className="absolute bottom-10 right-10 font-mono text-[10px] uppercase tracking-[0.4em] text-ink-500">
            phase 01 · foundation
          </div>
          {demoConnecting ? (
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-ember-500">
              Handshaking demo session…
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {demoMode && !demoConfig && <DemoMisconfigNotice />}
              {demoMode && demoConfig && demoFailed && <DemoUnavailableNotice />}
              <ConnectForm />
            </div>
          )}
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'firstTimers', label: 'First-Timers', badgeCount: firstTimerCount },
  ]

  return (
    <div className="flex h-screen flex-col">
      {demoMode && demoConfig && (
        <DemoBanner onSignIn={() => twitchAuthService.authorize()} />
      )}
      <ErrorBoundary label="Stream header">
        <StreamHeader />
      </ErrorBoundary>
      <main className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 p-4">
        {isMultiActive ? (
          <section className="flex flex-col min-h-0 border border-ink-800 bg-ink-900/40">
            <ErrorBoundary label="Multi-stream">
              <MultiStreamLayout />
            </ErrorBoundary>
          </section>
        ) : (
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
        )}
        <section className="flex flex-col min-h-0 border border-ink-800 bg-ink-900/40">
          <ErrorBoundary label="Heatmap">
            <HeatmapPanel />
          </ErrorBoundary>
        </section>
      </main>
      <ErrorBoundary label="Perf overlay" fallback={() => null}>
        <PerfOverlay />
      </ErrorBoundary>
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
