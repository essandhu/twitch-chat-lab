import { createContext } from 'react'

export const ChatScrollContext = createContext<(messageId: string) => void>(() => {})
