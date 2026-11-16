import type { Page } from 'playwright/test'
import type { ProfileData } from '@arcadia-eternity/local-profile'

/** Read committed browser data without accessing stores or mutating the application. */
export async function readPersistedProfile(page: Page): Promise<ProfileData | null> {
  return page.evaluate(
    () =>
      new Promise<ProfileData | null>((resolve, reject) => {
        const request = indexedDB.open('arcadia-profile', 1)
        request.onerror = () => reject(request.error)
        request.onupgradeneeded = () => {
          request.transaction!.abort()
        }
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('profile', 'readonly')
          const value = transaction.objectStore('profile').get('current')
          transaction.oncomplete = () => {
            db.close()
            resolve(value.result?.current.data ?? null)
          }
          transaction.onabort = () => {
            db.close()
            reject(transaction.error)
          }
        }
      }),
  )
}
