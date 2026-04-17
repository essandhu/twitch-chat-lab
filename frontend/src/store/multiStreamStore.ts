import { create } from 'zustand'
import type {
  ChannelChatMessageEvent,
  ChatMessage,
  EventAnnotation,
  FirstTimerEntry,
  HeatmapDataPoint,
} from '../types/twitch'
import { buildChatMessage } from './chatMessageMapper'

const MESSAGE_BUFFER_CAP = 5000
const ROLLING_WINDOW_POINTS = 300 // 5 minutes at 1-second cadence

export interface StreamSlice {
  login: string
  displayName: string
  broadcasterId: string
  messages: ChatMessage[]
  seenUserIds: Set<string>
  firstTimers: FirstTimerEntry[]
  currentMsgPerSec: number
  peakMsgPerSec: number
  dataPoints: HeatmapDataPoint[]
  annotations: EventAnnotation[]
  _counter: number
  isDegraded: boolean
}

export interface MultiStreamStoreState {
  streams: Record<string, StreamSlice>
  order: string[]
  isActive: boolean

  addStream: (init: Pick<StreamSlice, 'login' | 'displayName' | 'broadcasterId'>) => void
  removeStream: (login: string) => void
  addMessage: (login: string, raw: ChannelChatMessageEvent) => void
  addAnnotation: (login: string, annotation: EventAnnotation) => void
  incrementCounter: (login: string) => void
  tickAll: () => void
  reset: () => void
  setActive: (active: boolean) => void
  setDegraded: (login: string, degraded: boolean) => void
}

const createEmptySlice = (
  init: Pick<StreamSlice, 'login' | 'displayName' | 'broadcasterId'>,
): StreamSlice => ({
  login: init.login,
  displayName: init.displayName,
  broadcasterId: init.broadcasterId,
  messages: [],
  seenUserIds: new Set<string>(),
  firstTimers: [],
  currentMsgPerSec: 0,
  peakMsgPerSec: 0,
  dataPoints: [],
  annotations: [],
  _counter: 0,
  isDegraded: false,
})

export const useMultiStreamStore = create<MultiStreamStoreState>((set) => ({
  streams: {},
  order: [],
  isActive: false,

  addStream: (init) =>
    set((state) => {
      if (state.streams[init.login]) {
        return state
      }
      return {
        streams: { ...state.streams, [init.login]: createEmptySlice(init) },
        order: [...state.order, init.login],
      }
    }),

  removeStream: (login) =>
    set((state) => {
      if (!state.streams[login]) {
        return state
      }
      const nextStreams = { ...state.streams }
      delete nextStreams[login]
      return {
        streams: nextStreams,
        order: state.order.filter((l) => l !== login),
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

      let nextSlice: StreamSlice
      if (!isFirst) {
        nextSlice = { ...slice, messages: nextMessages }
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

  reset: () => set({ streams: {}, order: [], isActive: false }),

  setActive: (active) => set({ isActive: active }),

  setDegraded: (login, degraded) =>
    set((state) => {
      const slice = state.streams[login]
      if (!slice) {
        return state
      }
      return {
        streams: {
          ...state.streams,
          [login]: { ...slice, isDegraded: degraded },
        },
      }
    }),
}))

export const useStreamSlice = (login: string): StreamSlice | undefined =>
  useMultiStreamStore((s) => s.streams[login])
