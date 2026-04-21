import { createTwitchAuthService } from '../../services/TwitchAuthService'
import { createTwitchHelixClient } from '../../services/TwitchHelixClient'
import { EventSubManager } from '../../services/EventSubManager'
import { initAccountAgeService } from '../../services/accountAgeService'
import { SessionRecorder } from '../../services/SessionRecorder'
import { SessionReplayer } from '../../services/SessionReplayer'

export const twitchAuthService = createTwitchAuthService()
export const twitchHelixClient = createTwitchHelixClient(twitchAuthService)
export const eventSubManager = new EventSubManager(twitchHelixClient)
export const accountAgeService = initAccountAgeService(twitchHelixClient)
export const sessionRecorder = new SessionRecorder(eventSubManager)
export const sessionReplayer = new SessionReplayer(eventSubManager)
