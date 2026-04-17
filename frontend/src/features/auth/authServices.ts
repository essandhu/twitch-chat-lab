import { createTwitchAuthService } from '../../services/TwitchAuthService'
import { createTwitchHelixClient } from '../../services/TwitchHelixClient'
import { EventSubManager } from '../../services/EventSubManager'

export const twitchAuthService = createTwitchAuthService()
export const twitchHelixClient = createTwitchHelixClient(twitchAuthService)
export const eventSubManager = new EventSubManager(twitchHelixClient)
