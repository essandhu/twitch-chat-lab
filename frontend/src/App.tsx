import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useChatStore } from './store/chatStore'
import { useMultiStreamStore } from './store/multiStreamStore'
import { usePerfStore } from './store/perfStore'
import { AuthCallback } from './features/auth/AuthCallback'
import { ConnectForm } from './features/auth/ConnectForm'
import { twitchAuthService } from './features/auth/authServices'
import { startDemoSession } from './features/auth/demoSession'
import { StreamHeader } from './components/StreamHeader'
import { DemoBanner } from './components/DemoBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppShell } from './components/shell/AppShell'
import { MainPane } from './components/shell/MainPane'
import { TopNav } from './components/shell/TopNav'
import { LeftRail } from './components/shell/LeftRail'
import { ChatDock } from './components/shell/ChatDock'
import { Tabs } from './components/ui/Tabs'
import { Badge } from './components/ui/Badge'
import { ChatPanel } from './features/chat/ChatPanel'
import { FirstTimerPanel } from './features/firstTimers/FirstTimerPanel'
import { HeatmapPanel } from './features/heatmap/HeatmapPanel'
import { MultiStreamLayout } from './features/multiStream/MultiStreamLayout'
import { PerfOverlay } from './features/perfPanel/PerfOverlay'
import { getDemoConfig, isDemoMode } from './services/DemoModeService'
import { logger } from './lib/logger'

const DemoMisconfigNotice = () => (
  <div className="mb-8 max-w-md border border-warning/40 bg-surface-raised p-4 font-mono text-[11px] uppercase tracking-[0.22em] text-warning">
    Demo mode not configured — set VITE_DEMO_* in env.
  </div>
)

const DemoUnavailableNotice = () => (
  <div
    role="alert"
    className="mb-8 max-w-md border border-warning/40 bg-surface-raised p-4 font-mono text-[11px] uppercase tracking-[0.22em] text-warning"
  >
    Demo unavailable — couldn't find a live channel. Try again in a moment.
  </div>
)

const MainPaneContent = () => {
  const session = useChatStore((s) => s.session)
  const firstTimerCount = useChatStore((s) => s.firstTimers.length)
  const isMultiActive = useMultiStreamStore((s) => s.isActive)

  const demoMode = isDemoMode()
  const demoConfig = useMemo(() => (demoMode ? getDemoConfig() : null), [demoMode])
  const [demoFailed, setDemoFailed] = useState(false)

  const demoStartedRef = useRef(false)
  useEffect(() => {
    if (!demoConfig) return
    if (demoStartedRef.current) return
    demoStartedRef.current = true
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

  const demoConnecting = demoMode && demoConfig !== null && !demoFailed

  if (!session) {
    return (
      <>
        {demoConnecting && (
          <DemoBanner onSignIn={() => twitchAuthService.authorize()} />
        )}
        <div className="flex min-h-full flex-1 items-center justify-center px-6 py-12">
          {demoConnecting ? (
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              Handshaking demo session…
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {demoMode && !demoConfig && <DemoMisconfigNotice />}
              {demoMode && demoConfig && demoFailed && <DemoUnavailableNotice />}
              <ConnectForm />
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {demoMode && demoConfig && (
        <DemoBanner onSignIn={() => twitchAuthService.authorize()} />
      )}
      <ErrorBoundary label="Stream header">
        <StreamHeader />
      </ErrorBoundary>
      <main className="flex-1 min-h-0 flex flex-col p-4">
        {isMultiActive ? (
          <section className="flex-1 min-h-0 flex flex-col border border-border bg-surface/40 rounded-lg">
            <ErrorBoundary label="Multi-stream">
              <MultiStreamLayout />
            </ErrorBoundary>
          </section>
        ) : (
          <Tabs.Root defaultValue="firstTimers" className="flex-1 min-h-0 flex flex-col">
            <Tabs.List>
              <Tabs.Trigger value="firstTimers">
                First-Timers
                {firstTimerCount > 0 && (
                  <Badge variant="accent" className="ml-2">
                    {firstTimerCount}
                  </Badge>
                )}
              </Tabs.Trigger>
              <Tabs.Trigger value="heatmap">Heatmap</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="firstTimers" className="flex-1 min-h-0">
              <ErrorBoundary label="First-timers">
                <FirstTimerPanel />
              </ErrorBoundary>
            </Tabs.Content>
            <Tabs.Content value="heatmap" className="flex-1 min-h-0">
              <ErrorBoundary label="Heatmap">
                <HeatmapPanel />
              </ErrorBoundary>
            </Tabs.Content>
          </Tabs.Root>
        )}
      </main>
    </>
  )
}

const ChatDockContent = () => {
  const session = useChatStore((s) => s.session)
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-text-muted">
        Connect a channel to see chat.
      </div>
    )
  }
  return (
    <ErrorBoundary label="Chat">
      <ChatPanel />
    </ErrorBoundary>
  )
}

export const LandingView = () => {
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

  return (
    <>
      <AppShell
        top={<TopNav />}
        rail={<LeftRail />}
        main={
          <MainPane>
            <MainPaneContent />
          </MainPane>
        }
        dock={
          <ChatDock>
            <ChatDockContent />
          </ChatDock>
        }
      />
      <ErrorBoundary label="Perf overlay" fallback={() => null}>
        <PerfOverlay />
      </ErrorBoundary>
    </>
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
