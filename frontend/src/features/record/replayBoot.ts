import { sessionReplayer } from '../auth/authServices'
import { useChatStore } from '../../store/chatStore'
import { useHeatmapStore } from '../../store/heatmapStore'
import { useIntelligenceStore } from '../../store/intelligenceStore'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { useSemanticStore } from '../../store/semanticStore'
import type {
  ChannelChatMessageEvent,
  EventSubFrame,
  EventSubNotificationPayload,
  RecordedFrame,
  StreamSession,
} from '../../types/twitch'
import { logger } from '../../lib/logger'

export const isReplayMode = (): boolean => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('replay')
}

export const getReplayFixturePath = (): string | null => {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('replay')
  if (!v || v === '1') return null
  return v
}

export const resetReplayStores = (): void => {
  useChatStore.getState().clearMessages()
  useHeatmapStore.getState().reset()
  useIntelligenceStore.getState().reset()
  useSemanticStore.getState().reset()
  useMultiStreamStore.getState().reset()
}

const buildReplaySession = (frames: RecordedFrame[]): StreamSession | null => {
  for (const frame of frames) {
    if (frame.kind !== 'notification') continue
    const eventFrame = frame.payload as EventSubFrame
    const notif = eventFrame.payload as EventSubNotificationPayload
    const event = notif.event as ChannelChatMessageEvent | undefined
    if (!event || !event.broadcaster_user_id) continue
    return {
      broadcasterId: event.broadcaster_user_id,
      broadcasterLogin: event.broadcaster_user_login,
      broadcasterDisplayName: event.broadcaster_user_name,
      streamTitle: `Replay · ${event.broadcaster_user_login}`,
      gameName: 'Replay',
      gameId: '',
      viewerCount: 0,
      startedAt: new Date(frame.t),
      isConnected: true,
    }
  }
  return null
}

export const enterReplayMode = async (source: Blob | File): Promise<void> => {
  resetReplayStores()
  const info = await sessionReplayer.load(source)
  // Replace onReset on the singleton to wire backwards-seek store clearing.
  ;(sessionReplayer as unknown as { onReset: (() => void) | null }).onReset = resetReplayStores

  // Expose test hooks for Playwright E2E (replay.spec.ts P11-19). Dev-only
  // scaffolding — production builds exclude the ?replay path gate, so this
  // binding is unreachable outside replay mode.
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __sessionReplayer?: unknown }).__sessionReplayer = sessionReplayer
    ;(window as unknown as { __stores?: unknown }).__stores = {
      chatStore: useChatStore,
      heatmapStore: useHeatmapStore,
      intelligenceStore: useIntelligenceStore,
      semanticStore: useSemanticStore,
      multiStreamStore: useMultiStreamStore,
    }
  }
  const text = await source.slice(0).text()
  const frames: RecordedFrame[] = []
  const lines = text.split('\n')
  for (const line of lines.slice(1)) {
    if (!line) continue
    try {
      frames.push(JSON.parse(line) as RecordedFrame)
    } catch {
      // malformed frames already surfaced by sessionReplayer.load — skip here
    }
  }
  const session = buildReplaySession(frames)
  if (session) {
    useChatStore.getState().setSession(session)
  } else {
    logger.warn('replay.no_session_in_fixture', { streamLogins: info.streamLogins })
  }
}

export const enterReplayFromUrl = async (): Promise<boolean> => {
  const path = getReplayFixturePath()
  if (!path) return false
  try {
    const res = await fetch(path)
    if (!res.ok) {
      logger.error('replay.fetch_failed', { path, status: res.status })
      return false
    }
    const blob = await res.blob()
    await enterReplayMode(blob)
    return true
  } catch (err) {
    logger.error('replay.boot_failed', { path, error: String(err) })
    return false
  }
}
