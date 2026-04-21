import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useChatStore } from './store/chatStore'
import { useMultiStreamStore } from './store/multiStreamStore'
import { usePerfStore } from './store/perfStore'
import { useSemanticStore } from './store/semanticStore'
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
import { ChatPanel } from './features/chat/ChatPanel'
import { HeatmapPanel } from './features/heatmap/HeatmapPanel'
import { MultiStreamChatDock } from './features/multiStream/MultiStreamChatDock'
import { MultiStreamLayout } from './features/multiStream/MultiStreamLayout'
import { IntelligencePanel } from './features/intelligence/IntelligencePanel'
import { Tabs } from './components/ui/Tabs'
import { PerfOverlay } from './features/perfPanel/PerfOverlay'
import { applyFilterFromUrl } from './features/filters/applyFilterFromUrl'
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
          <section className="flex-1 min-h-0 flex flex-col">
            <ErrorBoundary label="Heatmap">
              <HeatmapPanel />
            </ErrorBoundary>
          </section>
        )}
      </main>
    </>
  )
}

const SINGLE_DOCK_TAB_KEY = 'tcl.single-dock.tab'

const readSingleDockTab = (): string => {
  try {
    if (typeof localStorage === 'undefined') return 'chat'
    return localStorage.getItem(SINGLE_DOCK_TAB_KEY) ?? 'chat'
  } catch {
    return 'chat'
  }
}

const storeSingleDockTab = (tab: string): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SINGLE_DOCK_TAB_KEY, tab)
  } catch {
    // ignore
  }
}

const ChatDockContent = () => {
  const session = useChatStore((s) => s.session)
  const [tab, setTab] = useState<string>(() => readSingleDockTab())

  useEffect(() => {
    storeSingleDockTab(tab)
  }, [tab])

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-text-muted">
        Connect a channel to see chat.
      </div>
    )
  }
  return (
    <ErrorBoundary label="Chat">
      <Tabs.Root value={tab} onValueChange={setTab} className="flex h-full flex-col">
        <Tabs.List>
          <Tabs.Trigger value="chat">Chat</Tabs.Trigger>
          <Tabs.Trigger value="intelligence">Intelligence</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="chat" className="flex-1 min-h-0 pt-0">
          <ChatPanel />
        </Tabs.Content>
        <Tabs.Content value="intelligence" className="flex-1 min-h-0 pt-0">
          <IntelligencePanel mode="single" />
        </Tabs.Content>
      </Tabs.Root>
    </ErrorBoundary>
  )
}

export const LandingView = () => {
  const isMultiActive = useMultiStreamStore((s) => s.isActive)

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

  const semanticBootedRef = useRef(false)
  useEffect(() => {
    if (semanticBootedRef.current) return
    semanticBootedRef.current = true
    if (new URLSearchParams(window.location.search).get('semantic') === '0') return
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number }
    const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 500))
    schedule(() => void useSemanticStore.getState().activate(), { timeout: 2000 })
  }, [])

  const urlFilterAppliedRef = useRef(false)
  useEffect(() => {
    if (urlFilterAppliedRef.current) return
    urlFilterAppliedRef.current = true
    applyFilterFromUrl({
      isMultiActive: useMultiStreamStore.getState().isActive,
      setChatFilter: (partial) => useChatStore.getState().setFilterState(partial),
      applyToAllStreams: (state) => useMultiStreamStore.getState().applyFilterToAllStreams(state),
    })
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
          isMultiActive ? (
            <ChatDock key="multi">
              <MultiStreamChatDock />
            </ChatDock>
          ) : (
            <ChatDock key="single">
              <ChatDockContent />
            </ChatDock>
          )
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
