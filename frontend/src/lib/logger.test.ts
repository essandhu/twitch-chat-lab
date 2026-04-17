import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearGlobalCorrelationId,
  logger,
  setGlobalCorrelationId,
  withCorrelationId,
} from './logger'

const parseLine = (spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> => {
  const call = spy.mock.calls.at(-1)
  if (!call) throw new Error('no log emitted')
  return JSON.parse(call[0] as string)
}

describe('logger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let debugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearGlobalCorrelationId()
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits one JSON line per info call with level, timestamp, message, context', () => {
    logger.info('hello', { foo: 1 })
    const log = parseLine(infoSpy)
    expect(log.level).toBe('info')
    expect(log.message).toBe('hello')
    expect(log.foo).toBe(1)
    expect(typeof log.timestamp).toBe('string')
    expect(() => new Date(log.timestamp as string).toISOString()).not.toThrow()
  })

  it('routes warn, error, debug to the matching console method', () => {
    logger.warn('a')
    logger.error('b')
    logger.debug('c')
    expect(parseLine(warnSpy).level).toBe('warn')
    expect(parseLine(errorSpy).level).toBe('error')
    expect(parseLine(debugSpy).level).toBe('debug')
  })

  it('omits correlationId when none is set', () => {
    logger.info('no correlation')
    const log = parseLine(infoSpy)
    expect(log.correlationId).toBeUndefined()
  })

  it('sets a global correlation ID for subsequent logs', () => {
    setGlobalCorrelationId('session-abc')
    logger.info('with global')
    expect(parseLine(infoSpy).correlationId).toBe('session-abc')
  })

  it('withCorrelationId scopes the id to the callback and restores prior value', () => {
    setGlobalCorrelationId('outer')
    withCorrelationId('inner', () => {
      logger.info('inside')
      expect(parseLine(infoSpy).correlationId).toBe('inner')
    })
    logger.info('after')
    expect(parseLine(infoSpy).correlationId).toBe('outer')
  })

  it('withCorrelationId returns the callback result', () => {
    const result = withCorrelationId('x', () => 42)
    expect(result).toBe(42)
  })
})
