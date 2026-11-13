import { ProfileError } from './schema'
import { type Envelope, type ProfileStorage, type ProfileExpectation } from './repository'

export class BrowserProfileStorage implements ProfileStorage {
  constructor(
    private factory?: IDBFactory,
    private name = 'arcadia-profile',
  ) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = (this.factory ?? indexedDB).open(this.name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('profile')
      request.onerror = () => reject(storageError(request.error))
      request.onblocked = () => reject(new ProfileError('PROFILE_BUSY'))
      request.onsuccess = () => resolve(request.result)
    })
  }
  async read(): Promise<Envelope | null> {
    const db = await this.open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('profile', 'readonly')
        const request = tx.objectStore('profile').get('current')
        tx.oncomplete = () => resolve(request.result ?? null)
        tx.onabort = () => reject(storageError(tx.error))
      })
    } finally {
      db.close()
    }
  }
  async readRaw() {
    const value = await this.read()
    return value === null ? null : JSON.stringify(value)
  }
  async commit(expected: ProfileExpectation, next: Envelope): Promise<void> {
    const db = await this.open()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('profile', 'readwrite')
        let conflict = false
        let writeError: DOMException | null = null
        const store = tx.objectStore('profile'),
          request = store.get('current')
        request.onsuccess = () => {
          const current = request.result as Envelope | undefined
          if (
            typeof expected === 'object' && expected !== null
              ? JSON.stringify(current) !== expected.corrupt
              : (current?.current?.revision ?? null) !== expected
          ) {
            conflict = true
            tx.abort()
            return
          }
          try {
            store.put(next, 'current')
          } catch (error) {
            writeError = error as DOMException
            tx.abort()
          }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () =>
          reject(conflict ? new ProfileError('REVISION_CONFLICT') : storageError(writeError ?? tx.error))
      })
    } finally {
      db.close()
    }
  }
}
function storageError(error: DOMException | null) {
  return new ProfileError(
    error?.name === 'QuotaExceededError' ? 'STORAGE_FULL' : 'STORAGE_DENIED',
    error?.message ?? '无法访问资料存储',
  )
}
