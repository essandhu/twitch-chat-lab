import { logger } from '../lib/logger'

const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize'
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate'
const OAUTH_STATE_KEY = 'twitch_oauth_state'
const VALIDATE_INTERVAL_MS = 5 * 60 * 1000

const REQUESTED_SCOPES = [
  'user:read:chat',
  'channel:read:subscriptions',
  'channel:read:hype_train',
]

export interface AuthServiceConfig {
  clientId: string
  redirectUri: string
}

export interface HandleCallbackResult {
  success: boolean
  error?: 'state_mismatch' | 'missing_token' | 'missing_state'
}

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const parseFragment = (fragment: string): URLSearchParams => {
  const stripped = fragment.startsWith('#') ? fragment.slice(1) : fragment
  return new URLSearchParams(stripped)
}

export class TwitchAuthService {
  private config: AuthServiceConfig
  private token: string | null = null
  private expiresAt = 0
  private reAuthHandler: (() => void) | null = null
  private validateTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: AuthServiceConfig) {
    this.config = config
  }

  authorize(): void {
    const state = generateState()
    sessionStorage.setItem(OAUTH_STATE_KEY, state)
    const url = new URL(TWITCH_AUTHORIZE_URL)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('response_type', 'token')
    url.searchParams.set('scope', REQUESTED_SCOPES.join(' '))
    url.searchParams.set('state', state)
    logger.info('auth.authorize.redirect', { clientId: this.config.clientId })
    window.location.assign(url.toString())
  }

  handleCallback(fragment: string): HandleCallbackResult {
    const params = parseFragment(fragment)
    const returnedState = params.get('state')
    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY)

    if (!expectedState) {
      logger.warn('auth.callback.missing_state')
      return { success: false, error: 'missing_state' }
    }
    if (returnedState !== expectedState) {
      logger.warn('auth.callback.state_mismatch', { returnedState })
      return { success: false, error: 'state_mismatch' }
    }

    const accessToken = params.get('access_token')
    const expiresInStr = params.get('expires_in')
    if (!accessToken) {
      logger.warn('auth.callback.missing_token')
      return { success: false, error: 'missing_token' }
    }

    const expiresIn = expiresInStr ? Number.parseInt(expiresInStr, 10) : 3600
    this.setToken(accessToken, expiresIn)
    sessionStorage.removeItem(OAUTH_STATE_KEY)
    logger.info('auth.callback.success', { expiresIn })
    return { success: true }
  }

  setToken(token: string, expiresInSeconds: number): void {
    this.token = token
    this.expiresAt = Date.now() + expiresInSeconds * 1000
  }

  getToken(): string | null {
    if (!this.token) return null
    if (Date.now() >= this.expiresAt) {
      this.clearToken()
      return null
    }
    return this.token
  }

  clearToken(): void {
    this.token = null
    this.expiresAt = 0
  }

  async validate(): Promise<boolean> {
    const token = this.getToken()
    if (!token) return false

    try {
      const response = await fetch(TWITCH_VALIDATE_URL, {
        headers: { Authorization: `OAuth ${token}` },
      })
      if (response.status === 401) {
        logger.warn('auth.validate.unauthorized')
        this.clearToken()
        this.reAuthHandler?.()
        return false
      }
      if (!response.ok) {
        logger.warn('auth.validate.non_ok', { status: response.status })
        return false
      }
      logger.debug('auth.validate.ok')
      return true
    } catch (err) {
      logger.error('auth.validate.network_error', { error: String(err) })
      return false
    }
  }

  startValidationPolling(): void {
    this.stopValidationPolling()
    this.validateTimer = setInterval(() => {
      void this.validate()
    }, VALIDATE_INTERVAL_MS)
  }

  stopValidationPolling(): void {
    if (this.validateTimer) {
      clearInterval(this.validateTimer)
      this.validateTimer = null
    }
  }

  onReAuthRequired(handler: () => void): void {
    this.reAuthHandler = handler
  }
}

const getEnv = (key: string): string => {
  const value = import.meta.env[key]
  if (typeof value !== 'string' || value.length === 0) {
    // Env vars are verified at app boot; at test time stubEnv provides them.
    return ''
  }
  return value
}

export const createTwitchAuthService = (): TwitchAuthService =>
  new TwitchAuthService({
    clientId: getEnv('VITE_TWITCH_CLIENT_ID'),
    redirectUri: getEnv('VITE_TWITCH_REDIRECT_URI'),
  })
