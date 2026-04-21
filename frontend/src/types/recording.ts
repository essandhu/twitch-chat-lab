export const SCHEMA_VERSION = 1 as const

export interface RecordingHeader {
  schemaVersion: 1
  recordedAt: string
  recorderVersion: string
}

export type RecordedFrameKind =
  | 'session_welcome'
  | 'notification'
  | 'session_keepalive'
  | 'session_reconnect'
  | 'revocation'

export interface RecordedFrame {
  t: string
  kind: RecordedFrameKind
  streamLogin: string
  payload: unknown
}

export type ReplaySpeed = 0.5 | 1 | 2 | 5

export type RecorderSchemaErrorCode =
  | 'unknown-schema-version'
  | 'malformed-header'
  | 'malformed-frame'
  | 'empty-recording'

export class RecorderSchemaError extends Error {
  readonly code: RecorderSchemaErrorCode
  readonly details?: unknown

  constructor(args: { code: RecorderSchemaErrorCode; message?: string; details?: unknown }) {
    super(args.message ?? args.code)
    this.name = 'RecorderSchemaError'
    this.code = args.code
    this.details = args.details
  }
}
