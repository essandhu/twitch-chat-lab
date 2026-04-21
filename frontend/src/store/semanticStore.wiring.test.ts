import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../types/twitch'
import { useSemanticStore } from './semanticStore'

vi.mock('../services/accountAgeService', () => ({
  getAccountAge: vi.fn(async () => ({ bucket: 'unknown', source: 'approximate' })),
}))

const makeMsg = (id: string): ChatMessage => ({
  id,
  userId: 'u',
  userLogin: 'u',
  displayName: 'U',
  color: '#fff',
  badges: [],
  fragments: [{ type: 'text', text: 'hi' }],
  text: 'hi',
  isFirstInSession: false,
  isHighlighted: false,
  timestamp: new Date(1000),
  messageType: 'text',
})

describe('semanticStore — tick wiring semantics', () => {
  beforeEach(() => {
    useSemanticStore.getState().reset()
  })

  it('ingestMessage is a no-op when status is loading', () => {
    const svc = { embedBatch: vi.fn(), onStatus: vi.fn(() => () => {}), warm: vi.fn() }
    useSemanticStore.setState({
      activationByStream: { __primary__: true },
      status: 'loading',
      _service: svc as never,
    })
    useSemanticStore.getState().ingestMessage(makeMsg('m1'))
    expect(svc.embedBatch).not.toHaveBeenCalled()
  })

  it('ingestMessage queues when status is ready', () => {
    const svc = {
      embedBatch: vi.fn(async () => [{ messageId: 'm1', vector: Float32Array.from([1]) }]),
      onStatus: vi.fn(() => () => {}),
      warm: vi.fn(),
    }
    useSemanticStore.setState({
      activationByStream: { __primary__: true },
      status: 'ready',
      _service: svc as never,
    })
    useSemanticStore.getState().ingestMessage(makeMsg('m1'))
    expect(svc.embedBatch).toHaveBeenCalledTimes(1)
  })

  it('detectMoments is safe to call even when no state is present', () => {
    useSemanticStore.getState().detectMoments(1000)
    expect(useSemanticStore.getState().moments).toHaveLength(0)
  })
})
