type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  correlationId?: string
  [key: string]: unknown
}

let currentCorrelationId: string | undefined

const consoleFor = (level: LogLevel): ((...args: unknown[]) => void) => {
  if (level === 'warn') return console.warn
  if (level === 'error') return console.error
  if (level === 'debug') return console.debug
  return console.log
}

const emit = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  if (currentCorrelationId) entry.correlationId = currentCorrelationId
  consoleFor(level)(JSON.stringify(entry))
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
}

export const setGlobalCorrelationId = (id: string): void => {
  currentCorrelationId = id
}

export const clearGlobalCorrelationId = (): void => {
  currentCorrelationId = undefined
}

export const getCorrelationId = (): string | undefined => currentCorrelationId

export const withCorrelationId = <T>(id: string, fn: () => T): T => {
  const prior = currentCorrelationId
  currentCorrelationId = id
  try {
    return fn()
  } finally {
    currentCorrelationId = prior
  }
}
