import { create } from 'zustand'
import { laggedPearson, pearson } from '../features/heatmap/correlationMath'
import type {
  ChannelChatMessageEvent,
  ChatMessage,
  EventAnnotation,
  FilterState,
  FirstTimerEntry,
  HeatmapDataPoint,
} from '../types/twitch'
import { buildChatMessage } from './chatMessageMapper'

const MESSAGE_BUFFER_CAP = 5000
const ROLLING_WINDOW_POINTS = 300 // 5 minutes at 1-second cadence
const CORRELATION_WINDOW_SAMPLES = 60
const CORRELATION_MIN_SAMPLES = 10
const CORRELATION_MAX_LAG_SECONDS = 10

export const DEFAULT_FILTER_STATE: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

export const pairKeyFor = (a: string, b: string): string => [a, b].sort().join('|')

export interface CorrelationEntry {
  coefficient: number
  lagMs: number
  updatedAt: number
}

export type StreamConnectionState = 'connecting' | 'ready' | 'degraded'

export interface StreamSlice {
  login: string
  displayName: string
  broadcasterId: string
  profileImageUrl?: string
  messages: ChatMessage[]
  seenUserIds: Set<string>
  firstTimers: FirstTimerEntry[]
  currentMsgPerSec: number
  peakMsgPerSec: number
  dataPoints: HeatmapDataPoint[]
  annotations: EventAnnotation[]
  _counter: number
  connectionState: StreamConnectionState
}

export interface MultiStreamStoreState {
  streams: Record<string, StreamSlice>
  order: string[]
  isActive: boolean
  filterState: Record<string, FilterState>
  correlation: Record<string, CorrelationEntry>

  addStream: (
    init: Pick<StreamSlice, 'login' | 'displayName' | 'broadcasterId'> &
      Partial<Pick<StreamSlice, 'profileImageUrl'>>,
  ) => void
  removeStream: (login: string) => void
  addMessage: (login: string, raw: ChannelChatMessageEvent) => void
  addAnnotation: (login: string, annotation: EventAnnotation) => void
  incrementCounter: (login: string) => void
  tickAll: () => void
  tickCorrelation: () => void
  setStreamFilter: (login: string, next: FilterState | Partial<FilterState>) => void
  applyFilterToAllStreams: (state: FilterState) => void
  reset: () => void
  setActive: (active: boolean) => void
  setConnectionState: (login: string, state: StreamConnectionState) => void
  markReady: (login: string) => void
  setDegraded: (login: string, degraded: boolean) => void
}

const createEmptySlice = (
  init: Pick<StreamSlice, 'login' | 'displayName' | 'broadcasterId'> &
    Partial<Pick<StreamSlice, 'profileImageUrl'>>,
): StreamSlice => ({
  login: init.login,
  displayName: init.displayName,
  broadcasterId: init.broadcasterId,
  profileImageUrl: init.profileImageUrl,
  messages: [],
  seenUserIds: new Set<string>(),
  firstTimers: [],
  currentMsgPerSec: 0,
  peakMsgPerSec: 0,
  dataPoints: [],
  annotations: [],
  _counter: 0,
  connectionState: 'connecting',
})

export const useMultiStreamStore = create<MultiStreamStoreState>((set) => ({
  streams: {},
  order: [],
  isActive: false,
  filterState: {},
  correlation: {},

  addStream: (init) =>
    set((state) => {
      if (state.streams[init.login]) {
        return state
      }
      return {
        streams: { ...state.streams, [init.login]: createEmptySlice(init) },
        order: [...state.order, init.login],
        filterState: { ...state.filterState, [init.login]: { ...DEFAULT_FILTER_STATE } },
      }
    }),

  removeStream: (login) =>
    set((state) => {
      if (!state.streams[login]) {
        return state
      }
      const nextStreams = { ...state.streams }
      delete nextStreams[login]
      const nextFilter = { ...state.filterState }
      delete nextFilter[login]
      const nextCorrelation: Record<string, CorrelationEntry> = {}
      for (const [key, value] of Object.entries(state.correlation)) {
        const [a, b] = key.split('|')
        if (a !== login && b !== login) nextCorrelation[key] = value
      }
      return {
        streams: nextStreams,
        order: state.order.filter((l) => l !== login),
        filterState: nextFilter,
        correlation: nextCorrelation,
      }
    }),

  addMessage: (login, raw) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice) {
        return state
      }

      const isFirst = !slice.seenUserIds.has(raw.chatter_user_id)
      const chatMessage = buildChatMessage(raw, isFirst)

      const nextMessages =
        slice.messages.length >= MESSAGE_BUFFER_CAP
          ? [...slice.messages.slice(slice.messages.length - MESSAGE_BUFFER_CAP + 1), chatMessage]
          : [...slice.messages, chatMessage]

      // First message is strong evidence the subscription is live — promote from
      // connecting to ready. Leave degraded alone; that transition needs an
      // explicit recovery signal.
      const nextConnectionState: StreamConnectionState =
        slice.connectionState === 'connecting' ? 'ready' : slice.connectionState

      let nextSlice: StreamSlice
      if (!isFirst) {
        nextSlice = { ...slice, messages: nextMessages, connectionState: nextConnectionState }
      } else {
        const seenUserIds = new Set(slice.seenUserIds)
        seenUserIds.add(raw.chatter_user_id)
        const firstTimerEntry: FirstTimerEntry = {
          userId: raw.chatter_user_id,
          displayName: raw.chatter_user_name,
          userLogin: raw.chatter_user_login,
          message: raw.message.text,
          timestamp: chatMessage.timestamp,
        }
        nextSlice = {
          ...slice,
          messages: nextMessages,
          seenUserIds,
          firstTimers: [...slice.firstTimers, firstTimerEntry],
          connectionState: nextConnectionState,
        }
      }

      return {
        streams: { ...state.streams, [login]: nextSlice },
      }
    }),

  addAnnotation: (login, annotation) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice) {
        return state
      }
      return {
        streams: {
          ...state.streams,
          [login]: {
            ...slice,
            annotations: [...slice.annotations, annotation],
          },
        },
      }
    }),

  incrementCounter: (login) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice) {
        return state
      }
      return {
        streams: {
          ...state.streams,
          [login]: { ...slice, _counter: slice._counter + 1 },
        },
      }
    }),

  tickAll: () =>
    set((state) => {
      const timestamp = Math.round(Date.now() / 1000) * 1000
      const nextStreams: Record<string, StreamSlice> = {}

      for (const login of Object.keys(state.streams)) {
        const slice = state.streams[login]
        if (!slice) continue

        const msgPerSec = slice._counter
        const nextPoint: HeatmapDataPoint = { timestamp, msgPerSec }
        const appended = [...slice.dataPoints, nextPoint]
        const trimmed =
          appended.length > ROLLING_WINDOW_POINTS
            ? appended.slice(appended.length - ROLLING_WINDOW_POINTS)
            : appended

        nextStreams[login] = {
          ...slice,
          _counter: 0,
          currentMsgPerSec: msgPerSec,
          peakMsgPerSec: Math.max(slice.peakMsgPerSec, msgPerSec),
          dataPoints: trimmed,
        }
      }

      return { streams: nextStreams }
    }),

  tickCorrelation: () =>
    set((state) => {
      const logins = state.order
      if (logins.length < 2) return state
      const nextCorrelation: Record<string, CorrelationEntry> = { ...state.correlation }
      const updatedAt = Date.now()
      for (let i = 0; i < logins.length; i++) {
        for (let j = i + 1; j < logins.length; j++) {
          const loginA = logins[i]
          const loginB = logins[j]
          const a = state.streams[loginA]
          const b = state.streams[loginB]
          if (!a || !b) continue
          const seriesA = a.dataPoints
            .slice(-CORRELATION_WINDOW_SAMPLES)
            .map((p) => p.msgPerSec)
          const seriesB = b.dataPoints
            .slice(-CORRELATION_WINDOW_SAMPLES)
            .map((p) => p.msgPerSec)
          if (seriesA.length < CORRELATION_MIN_SAMPLES || seriesB.length < CORRELATION_MIN_SAMPLES) {
            continue
          }
          const len = Math.min(seriesA.length, seriesB.length)
          const alignedA = seriesA.slice(seriesA.length - len)
          const alignedB = seriesB.slice(seriesB.length - len)
          const coefficient = pearson(alignedA, alignedB)
          const { bestLagSeconds } = laggedPearson(alignedA, alignedB, CORRELATION_MAX_LAG_SECONDS)
          nextCorrelation[pairKeyFor(loginA, loginB)] = {
            coefficient,
            lagMs: bestLagSeconds * 1000,
            updatedAt,
          }
        }
      }
      return { correlation: nextCorrelation }
    }),

  setStreamFilter: (login, next) =>
    set((state) => {
      const existing = state.filterState[login] ?? { ...DEFAULT_FILTER_STATE }
      const isFull =
        typeof (next as FilterState).firstTimeOnly === 'boolean' &&
        typeof (next as FilterState).subscribersOnly === 'boolean' &&
        typeof (next as FilterState).keyword === 'string' &&
        typeof (next as FilterState).hypeModeOnly === 'boolean'
      const merged = isFull
        ? { ...(next as FilterState) }
        : { ...existing, ...(next as Partial<FilterState>) }
      return {
        filterState: { ...state.filterState, [login]: merged },
      }
    }),

  applyFilterToAllStreams: (nextState) =>
    set((state) => {
      const nextFilter: Record<string, FilterState> = {}
      for (const login of state.order) {
        nextFilter[login] = { ...nextState }
      }
      return { filterState: nextFilter }
    }),

  reset: () =>
    set({ streams: {}, order: [], isActive: false, filterState: {}, correlation: {} }),

  setActive: (active) => set({ isActive: active }),

  setConnectionState: (login, nextState) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice || slice.connectionState === nextState) {
        return state
      }
      return {
        streams: {
          ...state.streams,
          [login]: { ...slice, connectionState: nextState },
        },
      }
    }),

  markReady: (login) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice || slice.connectionState !== 'connecting') {
        return state
      }
      return {
        streams: {
          ...state.streams,
          [login]: { ...slice, connectionState: 'ready' },
        },
      }
    }),

  setDegraded: (login, degraded) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice) {
        return state
      }
      const nextConnection: StreamConnectionState = degraded ? 'degraded' : 'ready'
      if (slice.connectionState === nextConnection) {
        return state
      }
      return {
        streams: {
          ...state.streams,
          [login]: { ...slice, connectionState: nextConnection },
        },
      }
    }),
}))

export const useStreamSlice = (login: string): StreamSlice | undefined =>
  useMultiStreamStore((s) => s.streams[login])
