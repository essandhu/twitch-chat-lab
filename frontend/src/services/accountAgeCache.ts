import { logger } from '../lib/logger'

const DB_NAME = 'tcl.accountAge'
const STORE = 'users'
const DB_VERSION = 1

export interface AccountAgeCacheRecord {
  userId: string
  createdAt: string
  fetchedAt: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

const hasIDB = (): boolean => typeof indexedDB !== 'undefined'

export const open = (): Promise<IDBDatabase | null> => {
  if (!hasIDB()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'userId' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        logger.warn('accountAge.cache.error', { stage: 'open', error: String(req.error) })
        resolve(null)
      }
    } catch (err) {
      logger.warn('accountAge.cache.error', { stage: 'open', error: String(err) })
      resolve(null)
    }
  })
  return dbPromise
}

export const readMany = async (ids: string[]): Promise<Record<string, string | undefined>> => {
  const out: Record<string, string | undefined> = {}
  if (ids.length === 0) return out
  const db = await open()
  if (!db) return out
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      let pending = ids.length
      for (const id of ids) {
        const req = store.get(id)
        req.onsuccess = () => {
          const rec = req.result as AccountAgeCacheRecord | undefined
          if (rec) out[id] = rec.createdAt
          if (--pending === 0) resolve(out)
        }
        req.onerror = () => {
          if (--pending === 0) resolve(out)
        }
      }
      tx.onerror = () => {
        logger.warn('accountAge.cache.error', { stage: 'readMany', error: String(tx.error) })
        resolve(out)
      }
    } catch (err) {
      logger.warn('accountAge.cache.error', { stage: 'readMany', error: String(err) })
      resolve(out)
    }
  })
}

export const writeMany = async (records: AccountAgeCacheRecord[]): Promise<void> => {
  if (records.length === 0) return
  const db = await open()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const rec of records) store.put(rec)
      tx.oncomplete = () => resolve()
      tx.onerror = () => {
        logger.warn('accountAge.cache.error', { stage: 'writeMany', error: String(tx.error) })
        resolve()
      }
    } catch (err) {
      logger.warn('accountAge.cache.error', { stage: 'writeMany', error: String(err) })
      resolve()
    }
  })
}

export const _resetForTest = (): void => {
  dbPromise = null
}
