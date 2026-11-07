import {
  WorkRepository,
  emptyWorkspace,
  parseWorkspace,
  type WorkSnapshot,
  type WorkStorage,
  type WorkWorkspace,
} from '@arcadia-eternity/pack-loader/native'
import { getDesktopApi } from '@/utils/env'

export class BrowserWorkStorage implements WorkStorage {
  constructor(private readonly name = 'arcadia-creator-works-v1') {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let abandoned = false
      const request = indexedDB.open(this.name, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('workspace')
      }
      request.onsuccess = () => {
        if (abandoned) {
          request.result.close()
          return
        }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error ?? new Error('浏览器作品存储不可用'))
      request.onblocked = () => {
        abandoned = true
        reject(new Error('作品存储正在升级，请关闭其他创作窗口后重试'))
      }
    })
  }
  async read(): Promise<WorkSnapshot> {
    const db = await this.open()
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readonly')
        const request = transaction.objectStore('workspace').get('current')
        request.onsuccess = () => {
          try {
            const result = request.result as WorkSnapshot | undefined
            if (!result) resolve({ revision: 0, workspace: emptyWorkspace() })
            else if (!Number.isSafeInteger(result.revision) || result.revision < 0)
              reject(new Error('作品库修订号无效'))
            else resolve({ revision: result.revision, workspace: parseWorkspace(result.workspace) })
          } catch (error) {
            reject(error)
          }
        }
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  }
  async compareAndSwap(expected: number, input: WorkWorkspace): Promise<boolean> {
    if (!Number.isSafeInteger(expected) || expected < 0 || expected === Number.MAX_SAFE_INTEGER)
      throw new Error('作品库修订号无效')
    const workspace = parseWorkspace(input),
      db = await this.open()
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readwrite')
        const store = transaction.objectStore('workspace'),
          request = store.get('current')
        let changed = false
        request.onsuccess = () => {
          const revision = (request.result as WorkSnapshot | undefined)?.revision ?? 0
          if (revision !== expected) return
          store.put({ revision: expected + 1, workspace }, 'current')
          changed = true
        }
        transaction.oncomplete = () => resolve(changed)
        transaction.onerror = () => reject(transaction.error ?? new Error('保存作品失败'))
        transaction.onabort = () => reject(transaction.error ?? new Error('保存作品已取消'))
      })
    } finally {
      db.close()
    }
  }
}
export function createWorkRepository(): WorkRepository {
  const desktop = getDesktopApi()
  if (desktop) {
    if (!desktop.readWorkWorkspace || !desktop.compareAndSwapWorkWorkspace)
      throw new Error('此桌面版本尚不支持作品库，请更新客户端')
    return new WorkRepository({
      read: () => desktop.readWorkWorkspace!(),
      compareAndSwap: (expected, workspace) => desktop.compareAndSwapWorkWorkspace!({ expected, workspace }),
    })
  }
  return new WorkRepository(new BrowserWorkStorage())
}
