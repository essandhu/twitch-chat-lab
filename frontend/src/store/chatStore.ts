import { create } from 'zustand'
import type {
  BadgeMap,
  ChannelChatMessageEvent,
  ChatMessage,
  ChatRow,
  FilterState,
  FirstTimerEntry,
  PinnedMessage,
  StreamSession,
  SystemEvent,
} from '../types/twitch'
import { buildChatMessage } from './chatMessageMapper'

const MESSAGE_BUFFER_CAP = 5000

const INITIAL_FILTER_STATE: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

let rowIdSequence = 0
const nextRowId = (prefix: string): string => {
  rowIdSequence += 1
  return `${prefix}_${rowIdSequence}_${Date.now().toString(36)}`
}

interface ChatStoreState {
  session: StreamSession | null
  messages: ChatMessage[]
  rows: ChatRow[]
  messagesById: Record<string, ChatMessage>
  pinnedMessages: PinnedMessage[]
  filterState: FilterState
  seenUserIds: Set<string>
  firstTimers: FirstTimerEntry[]
  badgeDefinitions: BadgeMap

  addMessage: (raw: ChannelChatMessageEvent) => void
  addSystemEvent: (event: SystemEvent) => void
  applyDeletion: (messageId: string) => void
  applyUserClear: (targetUserId: string) => void
  applyChatClear: () => void
  addPin: (pin: PinnedMessage) => void
  removePin: (messageId: string) => void
  setFilterState: (partial: Partial<FilterState>) => void
  clearMessages: () => void
  setSession: (session: StreamSession | null) => void
  resetForNewChannel: () => void
  setBadgeDefinitions: (map: BadgeMap) => void
}

interface EvictionResult {
  rows: ChatRow[]
  messagesById: Record<string, ChatMessage>
}

const appendRowWithCap = (
  rows: ChatRow[],
  messagesById: Record<string, ChatMessage>,
  next: ChatRow,
): EvictionResult => {
  const combined = [...rows, next]
  if (combined.length <= MESSAGE_BUFFER_CAP) {
    return { rows: combined, messagesById }
  }
  const overflow = combined.length - MESSAGE_BUFFER_CAP
  const evicted = combined.slice(0, overflow)
  const trimmed = combined.slice(overflow)
  const nextById = { ...messagesById }
  for (const row of evicted) {
    if (row.kind === 'message') delete nextById[row.message.id]
  }
  return { rows: trimmed, messagesById: nextById }
}

export const useChatStore = create<ChatStoreState>((set) => ({
  session: null,
  messages: [],
  rows: [],
  messagesById: {},
  pinnedMessages: [],
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

      const nextRow: ChatRow = { kind: 'message', id: chatMessage.id, message: chatMessage }
      const { rows: nextRows, messagesById: prunedById } = appendRowWithCap(
        state.rows,
        state.messagesById,
        nextRow,
      )
      const nextById = { ...prunedById, [chatMessage.id]: chatMessage }

      if (!isFirst) {
        return { messages: nextMessages, rows: nextRows, messagesById: nextById }
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
        rows: nextRows,
        messagesById: nextById,
        seenUserIds,
        firstTimers: [...state.firstTimers, firstTimerEntry],
      }
    }),

  addSystemEvent: (event) =>
    set((state) => {
      const nextRow: ChatRow = {
        kind: 'system',
        id: nextRowId('sys'),
        event,
        timestamp: new Date(),
      }
      const { rows, messagesById } = appendRowWithCap(state.rows, state.messagesById, nextRow)
      return { rows, messagesById }
    }),

  applyDeletion: (messageId) =>
    set((state) => {
      const idx = state.rows.findIndex(
        (r) => r.kind === 'message' && r.message.id === messageId,
      )
      if (idx < 0) return {}
      const nextRows = state.rows.slice()
      nextRows[idx] = {
        kind: 'deletion',
        id: nextRowId('del'),
        messageId,
        deletedAt: new Date(),
      }
      const nextById = { ...state.messagesById }
      delete nextById[messageId]
      return { rows: nextRows, messagesById: nextById }
    }),

  applyUserClear: (targetUserId) =>
    set((state) => {
      let mutated = false
      const nextRows = state.rows.map((row) => {
        if (row.kind !== 'message' || row.message.userId !== targetUserId) return row
        mutated = true
        return {
          kind: 'deletion' as const,
          id: nextRowId('del'),
          messageId: row.message.id,
          deletedAt: new Date(),
        }
      })
      if (!mutated) return {}
      const nextById = { ...state.messagesById }
      for (const row of state.rows) {
        if (row.kind === 'message' && row.message.userId === targetUserId) {
          delete nextById[row.message.id]
        }
      }
      return { rows: nextRows, messagesById: nextById }
    }),

  applyChatClear: () =>
    set(() => ({
      rows: [{ kind: 'chat-cleared', id: nextRowId('clr'), clearedAt: new Date() }],
      messagesById: {},
      messages: [],
      pinnedMessages: [],
    })),

  addPin: (pin) =>
    set((state) => {
      if (state.pinnedMessages.some((p) => p.messageId === pin.messageId)) return {}
      return { pinnedMessages: [pin, ...state.pinnedMessages] }
    }),

  removePin: (messageId) =>
    set((state) => {
      if (!state.pinnedMessages.some((p) => p.messageId === messageId)) return {}
      return {
        pinnedMessages: state.pinnedMessages.filter((p) => p.messageId !== messageId),
      }
    }),

  setFilterState: (partial) =>
    set((state) => ({ filterState: { ...state.filterState, ...partial } })),

  clearMessages: () =>
    set({
      messages: [],
      rows: [],
      messagesById: {},
      pinnedMessages: [],
    }),

  setSession: (session) => set({ session }),

  resetForNewChannel: () =>
    set({
      messages: [],
      rows: [],
      messagesById: {},
      pinnedMessages: [],
      seenUserIds: new Set<string>(),
      firstTimers: [],
    }),

  setBadgeDefinitions: (map) => set({ badgeDefinitions: map }),
}))
