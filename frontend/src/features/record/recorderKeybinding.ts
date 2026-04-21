import { useEffect } from 'react'

const isTypingTarget = (el: Element | null): boolean => {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if ((el as HTMLElement).isContentEditable === true) return true
  const attr = el.getAttribute('contenteditable')
  return attr === '' || attr === 'true' || attr === 'plaintext-only'
}

export const useRecorderToggle = (callback: () => void): void => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isR = e.key === 'R' || e.key === 'r'
      const hasModifier = (e.ctrlKey || e.metaKey) && e.shiftKey
      if (!isR || !hasModifier || e.altKey) return
      if (isTypingTarget(document.activeElement)) return
      e.preventDefault()
      callback()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [callback])
}
