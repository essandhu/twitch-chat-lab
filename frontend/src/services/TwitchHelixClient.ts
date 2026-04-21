import { logger } from '../lib/logger'
import type {
  BadgeMap,
  HelixBadgeSet,
  HelixChatSettings,
  HelixResponse,
  HelixStream,
  HelixUser,
} from '../types/twitch'
import type { TwitchAuthService } from './TwitchAuthService'

const HELIX_BASE = 'https://api.twitch.tv/helix'

export class HelixError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`Helix request failed: ${status}`)
    this.name = 'HelixError'
    this.status = status
    this.body = body
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

interface HelixClientConfig {
  clientId: string
  auth: TwitchAuthService
  fetchImpl?: typeof fetch
}

const normalizeBadges = (sets: HelixBadgeSet[]): BadgeMap => {
  const map: BadgeMap = {}
  for (const set of sets) {
    const versions: Record<string, string> = {}
    for (const v of set.versions) {
      versions[v.id] = v.image_url_2x
    }
    map[set.set_id] = versions
  }
  return map
}

export class TwitchHelixClient {
  private clientId: string
  private auth: TwitchAuthService
  private fetchImpl: typeof fetch

  constructor({ clientId, auth, fetchImpl }: HelixClientConfig) {
    this.clientId = clientId
    this.auth = auth
    this.fetchImpl = fetchImpl ?? fetch.bind(globalThis)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.auth.getToken()
    if (!token) {
      throw new UnauthorizedError()
    }

    const url = `${HELIX_BASE}${path}`
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Client-Id': this.clientId,
      },
    })

    if (response.status === 401) {
      logger.warn('helix.unauthorized', { path })
      this.auth.clearToken()
      throw new UnauthorizedError()
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('helix.non_ok', { path, status: response.status, body })
      throw new HelixError(response.status, body)
    }

    return (await response.json()) as T
  }

  async getUser(login?: string): Promise<HelixUser | null> {
    const path = login ? `/users?login=${encodeURIComponent(login)}` : '/users'
    const res = await this.request<HelixResponse<HelixUser>>(path)
    return res.data[0] ?? null
  }

  async getUsersByIds(userIds: string[]): Promise<HelixUser[]> {
    if (userIds.length === 0) return []
    if (userIds.length > 100) throw new HelixError(400, 'batch limit 100')
    const query = userIds.map((id) => `id=${encodeURIComponent(id)}`).join('&')
    const res = await this.request<HelixResponse<HelixUser>>(`/users?${query}`)
    return res.data
  }

  async getStream(login: string): Promise<HelixStream | null> {
    const path = `/streams?user_login=${encodeURIComponent(login)}`
    const res = await this.request<HelixResponse<HelixStream>>(path)
    return res.data[0] ?? null
  }

  async getChatSettings(broadcasterId: string): Promise<HelixChatSettings> {
    const path = `/chat/settings?broadcaster_id=${encodeURIComponent(broadcasterId)}`
    const res = await this.request<HelixResponse<HelixChatSettings>>(path)
    const first = res.data[0]
    if (!first) throw new HelixError(404, 'no chat settings in response')
    return first
  }

  async getStreamsByCategory(gameId: string, first: number): Promise<HelixStream[]> {
    const path = `/streams?game_id=${encodeURIComponent(gameId)}&first=${first}`
    const res = await this.request<HelixResponse<HelixStream>>(path)
    return res.data
  }

  async getGlobalBadges(): Promise<BadgeMap> {
    const res = await this.request<HelixResponse<HelixBadgeSet>>('/chat/badges/global')
    return normalizeBadges(res.data)
  }

  async getChannelBadges(broadcasterId: string): Promise<BadgeMap> {
    const path = `/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`
    const res = await this.request<HelixResponse<HelixBadgeSet>>(path)
    return normalizeBadges(res.data)
  }

  async createEventSubSubscription(body: unknown): Promise<void> {
    await this.request<unknown>('/eventsub/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
}

const getEnv = (key: string): string => {
  const value = import.meta.env[key]
  return typeof value === 'string' ? value : ''
}

export const createTwitchHelixClient = (auth: TwitchAuthService): TwitchHelixClient =>
  new TwitchHelixClient({
    clientId: getEnv('VITE_TWITCH_CLIENT_ID'),
    auth,
  })
