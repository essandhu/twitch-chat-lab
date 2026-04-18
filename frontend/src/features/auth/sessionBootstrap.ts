import type { BadgeMap, StreamSession } from '../../types/twitch'

export const mergeBadges = (global: BadgeMap, channel: BadgeMap): BadgeMap => {
  const merged: BadgeMap = { ...global }
  for (const [setId, versions] of Object.entries(channel)) {
    merged[setId] = { ...(merged[setId] ?? {}), ...versions }
  }
  return merged
}

interface BroadcasterInfo {
  id: string
  login: string
  display_name: string
}

interface StreamInfo {
  title: string
  game_name: string
  game_id: string
  viewer_count: number
  started_at: string
}

export const buildSession = (
  broadcaster: BroadcasterInfo,
  stream: StreamInfo | null,
): StreamSession => ({
  broadcasterId: broadcaster.id,
  broadcasterLogin: broadcaster.login,
  broadcasterDisplayName: broadcaster.display_name,
  streamTitle: stream?.title ?? '',
  gameName: stream?.game_name ?? '',
  gameId: stream?.game_id ?? '',
  viewerCount: stream?.viewer_count ?? 0,
  startedAt: stream?.started_at ? new Date(stream.started_at) : new Date(0),
  isConnected: true,
})
