import { logger } from '../../lib/logger'
import type { DemoConfig } from '../../services/DemoModeService'
import { useChatStore } from '../../store/chatStore'
import { eventSubManager, twitchAuthService, twitchHelixClient } from './authServices'
import { buildSession, mergeBadges } from './sessionBootstrap'

// Just Chatting — high-traffic category so there's always a live broadcaster
// to pick. The demo deliberately does NOT fall back to a static channel when
// the query is empty (see pickLiveDemoChannel).
const DEMO_CATEGORY_GAME_ID = '509658'
const DEMO_CANDIDATE_COUNT = 20

const pickLiveDemoChannel = async (): Promise<string> => {
  const streams = await twitchHelixClient.getStreamsByCategory(
    DEMO_CATEGORY_GAME_ID,
    DEMO_CANDIDATE_COUNT,
  )
  const live = streams.find((s) => typeof s.user_login === 'string' && s.user_login.length > 0)
  if (!live) {
    throw new Error('no live demo channel available')
  }
  return live.user_login
}

export const startDemoSession = async (config: DemoConfig): Promise<void> => {
  twitchAuthService.useDemoToken(config.token, config.userId)

  const channel = config.channel ?? (await pickLiveDemoChannel())

  const broadcaster = await twitchHelixClient.getUser(channel)
  if (!broadcaster) {
    throw new Error(`demo channel not found: ${channel}`)
  }

  const [stream, globalBadges, channelBadges] = await Promise.all([
    twitchHelixClient.getStream(channel),
    twitchHelixClient.getGlobalBadges(),
    twitchHelixClient.getChannelBadges(broadcaster.id),
  ])

  const chat = useChatStore.getState()
  chat.resetForNewChannel()
  chat.setBadgeDefinitions(mergeBadges(globalBadges, channelBadges))
  chat.setSession(buildSession(broadcaster, stream))

  logger.info('auth.demo.connect', { channel, mode: config.mode })

  await eventSubManager.connect({
    broadcasterId: broadcaster.id,
    userId: config.userId,
    token: config.token,
  })
}
