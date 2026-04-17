import { create } from 'zustand'
import type {
  BadgeMap,
  ChannelChatMessageEvent,
  ChatMessage,
  FilterState,
  FirstTimerEntry,
  StreamSession,
} from '../types/twitch'
import { buildChatMessage } from './chatMessageMapper'

const MESSAGE_BUFFER_CAP = 5000

const INITIAL_FILTER_STATE: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

interface ChatStoreState {
  session: StreamSession | null
  messages: ChatMessage[]
  filterState: FilterState
  seenUserIds: Set<string>
  firstTimers: FirstTimerEntry[]
  badgeDefinitions: BadgeMap

  addMessage: (raw: ChannelChatMessageEvent) => void
  setFilterState: (partial: Partial<FilterState>) => void
  clearMessages: () => void
  setSession: (session: StreamSession | null) => void
  resetForNewChannel: () => void
  setBadgeDefinitions: (map: BadgeMap) => void
}

export const useChatStore = create<ChatStoreState>((set) => ({
  session: null,
  messages: [],
  filterState: { ...INITIAL_FILTER_STATE },
  seenUserIds: new Set<string>(),
  firstTimers: [],
  badgeDefinitions: {},

  addMessage: (raw) =>
    set((state) => {
      const isFirst = !state.seenUserIds.has(raw.chatter_user_id)
      const chatMessage = buildChatMessage(raw, isFirst)

      const nextMessages =
        state.messages.length >= MESSAGE_BUFFER_CAP
          ? [...state.messages.slice(state.messages.length - MESSAGE_BUFFER_CAP + 1), chatMessage]
          : [...state.messages, chatMessage]

      if (!isFirst) {
        return { messages: nextMessages }
      }

      const seenUserIds = new Set(state.seenUserIds)
      seenUserIds.add(raw.chatter_user_id)
      const firstTimerEntry: FirstTimerEntry = {
        userId: raw.chatter_user_id,
        displayName: raw.chatter_user_name,
        userLogin: raw.chatter_user_login,
        message: raw.message.text,
        timestamp: chatMessage.timestamp,
      }
      return {
        messages: nextMessages,
        seenUserIds,
        firstTimers: [...state.firstTimers, firstTimerEntry],
      }
    }),

  setFilterState: (partial) =>
    set((state) => ({ filterState: { ...state.filterState, ...partial } })),

  clearMessages: () => set({ messages: [] }),

  setSession: (session) => set({ session }),

  resetForNewChannel: () =>
    set({
      messages: [],
      seenUserIds: new Set<string>(),
      firstTimers: [],
    }),

  setBadgeDefinitions: (map) => set({ badgeDefinitions: map }),
}))
