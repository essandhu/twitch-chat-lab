import type { Page, WebSocketRoute } from '@playwright/test'

export interface ProxyEnvelopeHandle {
  ws: WebSocketRoute
  pushChat: (streamLogin: string, text: string, user?: string) => void
  pushUpstreamLost: (streamLogin: string) => void
}

const now = () => new Date().toISOString()
const isoInPast = (ms: number) => new Date(Date.now() - ms).toISOString()
const randomId = () => Math.random().toString(36).slice(2, 12)

const chatEnvelope = (streamLogin: string, user: string, text: string) => ({
  stream_login: streamLogin,
  event_type: 'channel.chat.message' as const,
  payload: {
    metadata: {
      message_id: `m_${randomId()}`,
      message_type: 'notification',
      message_timestamp: isoInPast(50),
      subscription_type: 'channel.chat.message',
      subscription_version: '1',
    },
    payload: {
      subscription: {
        id: `sub_${randomId()}`,
        type: 'channel.chat.message',
        version: '1',
        status: 'enabled',
        cost: 0,
        condition: {},
        transport: { method: 'websocket', session_id: 'mock-proxy-session' },
        created_at: now(),
      },
      event: {
        broadcaster_user_id: `uid_${streamLogin}`,
        broadcaster_user_login: streamLogin,
        broadcaster_user_name: streamLogin,
        chatter_user_id: `uid_${user}`,
        chatter_user_login: user.toLowerCase(),
        chatter_user_name: user,
        message_id: `chat_${randomId()}`,
        message: {
          text,
          fragments: [{ type: 'text', text }],
        },
        color: '#FF4500',
        badges: [],
        message_type: 'text',
        source_broadcaster_user_id: null,
      },
    },
  },
})

const upstreamLostEnvelope = (streamLogin: string) => ({
  error: 'upstream_lost' as const,
  stream_login: streamLogin,
})

export interface ProxySessionDeps {
  sessionId?: string
  onDelete?: () => void
}

export const installProxyRoutes = async (
  page: Page,
  opts: ProxySessionDeps = {},
): Promise<{ wsOpened: Promise<ProxyEnvelopeHandle>; sessionId: string; deleteCount: () => number }> => {
  const sessionId = opts.sessionId ?? 'fake-session-uuid'
  let deleteCalls = 0

  await page.route(/localhost:8080\/session(\/.*)?$/, (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session_id: sessionId }),
      })
    }
    if (method === 'DELETE') {
      deleteCalls += 1
      opts.onDelete?.()
      return route.fulfill({ status: 204, body: '' })
    }
    return route.continue()
  })

  let resolveWs: (h: ProxyEnvelopeHandle) => void
  const wsOpened = new Promise<ProxyEnvelopeHandle>((r) => {
    resolveWs = r
  })

  await page.routeWebSocket('ws://localhost:8080/ws/**', (ws: WebSocketRoute) => {
    resolveWs({
      ws,
      pushChat: (streamLogin, text, user = 'someviewer') =>
        ws.send(JSON.stringify(chatEnvelope(streamLogin, user, text))),
      pushUpstreamLost: (streamLogin) =>
        ws.send(JSON.stringify(upstreamLostEnvelope(streamLogin))),
    })
  })

  return {
    wsOpened,
    sessionId,
    deleteCount: () => deleteCalls,
  }
}
