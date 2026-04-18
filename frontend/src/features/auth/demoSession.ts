import { logger } from '../../lib/logger'
import type { DemoConfig } from '../../services/DemoModeService'
import { useChatStore } from '../../store/chatStore'
import { eventSubManager, twitchAuthService, twitchHelixClient } from './authServices'
import { buildSession, mergeBadges } from './sessionBootstrap'

export const startDemoSession = async (config: DemoConfig): Promise<void> => {
  twitchAuthService.useDemoToken(config.token, config.userId)

  const broadcaster = await twitchHelixClient.getUser(config.channel)
  if (!broadcaster) {
    throw new Error(`demo channel not found: ${config.channel}`)
  }

  const [stream, globalBadges, channelBadges] = await Promise.all([
    twitchHelixClient.getStream(config.channel),
    twitchHelixClient.getGlobalBadges(),
    twitchHelixClient.getChannelBadges(broadcaster.id),
  ])

  const chat = useChatStore.getState()
  chat.resetForNewChannel()
  chat.setBadgeDefinitions(mergeBadges(globalBadges, channelBadges))
  chat.setSession(buildSession(broadcaster, stream))

  logger.info('auth.demo.connect', { channel: config.channel, mode: config.mode })

  await eventSubManager.connect({
    broadcasterId: broadcaster.id,
    userId: config.userId,
    token: config.token,
  })
}
