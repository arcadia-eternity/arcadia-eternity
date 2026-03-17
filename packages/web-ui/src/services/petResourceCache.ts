import { reactive } from 'vue'
import { getDesktopApi, isDesktop } from '@/utils/env'

interface DesktopRuntimeState {
  initialized: boolean
  available: boolean
  localServerPort: number | null
}

const desktopRuntime: DesktopRuntimeState = {
  initialized: false,
  available: false,
  localServerPort: null,
}

async function initDesktopRuntime(): Promise<void> {
  if (!isDesktop || desktopRuntime.initialized) return

  desktopRuntime.initialized = true
  const api = getDesktopApi()
  if (!api) return

  desktopRuntime.available = true

  try {
    desktopRuntime.localServerPort = await api.getLocalServerPort()
  } catch (error) {
    console.warn('获取本地服务器端口失败:', error)
  }
}

interface CacheStats {
  total: number
  cached: number
  loading: number
}

interface CacheEntry {
  url: string
  cached: boolean
  loading: boolean
  error?: string
}

class PetResourceCache {
  private cache = new Map<number, CacheEntry>()
  private stats = reactive<CacheStats>({
    total: 0,
    cached: 0,
    loading: 0,
  })

  constructor() {
    void this.init()
  }

  private async init() {
    await initDesktopRuntime()
    await this.initStats()
  }

  getStats(): CacheStats {
    return this.stats
  }

  getLocalServerPort(): number | null {
    return desktopRuntime.localServerPort
  }

  getRemotePetUrl(num: number): string {
    return `https://seer2-pet-resource.yuuinih.com/public/fight/${num}.swf`
  }

  async initStats() {
    if (isDesktop) {
      const api = getDesktopApi()
      if (api) {
        try {
          const cachedPets = await api.listCachedPets()
          for (const num of cachedPets) {
            const url = this.getRemotePetUrl(num)
            this.cache.set(num, { url, cached: true, loading: false })
          }
        } catch (error) {
          console.warn('读取本地缓存目录失败:', error)
        }
      }
    }

    this.updateStats()
  }

  private updateStats() {
    this.stats.total = this.cache.size
    this.stats.cached = Array.from(this.cache.values()).filter(entry => entry.cached).length
    this.stats.loading = Array.from(this.cache.values()).filter(entry => entry.loading).length
  }

  private async ensureLocalServerPort(): Promise<void> {
    if (!isDesktop || desktopRuntime.localServerPort) return

    const api = getDesktopApi()
    if (!api) return

    try {
      desktopRuntime.localServerPort = await api.getLocalServerPort()
      if (desktopRuntime.localServerPort) {
        console.log('获取到本地服务器端口:', desktopRuntime.localServerPort)
      }
    } catch (error) {
      console.warn('获取本地服务器端口失败:', error)
    }
  }

  async getPetSwfUrl(num: number): Promise<string> {
    const remoteUrl = this.getRemotePetUrl(num)

    if (isDesktop) {
      await this.ensureLocalServerPort()

      const api = getDesktopApi()
      if (api && desktopRuntime.localServerPort) {
        const localHttpUrl = `http://127.0.0.1:${desktopRuntime.localServerPort}/cache/pets/${num}.swf`

        try {
          await api.downloadPetSwf(num, remoteUrl)
        } catch (error) {
          console.warn(`Pet ${num}: 本地预下载失败，将按需回退到本地服务懒加载`, error)
        }

        return localHttpUrl
      }
    }

    return remoteUrl
  }

  isCached(num: number): boolean {
    const entry = this.cache.get(num)
    return entry?.cached || false
  }

  async isLocalFileExists(num: number): Promise<boolean> {
    if (!isDesktop) return false

    await this.ensureLocalServerPort()
    if (!desktopRuntime.localServerPort) return false

    try {
      const response = await fetch(`http://127.0.0.1:${desktopRuntime.localServerPort}/cache/pets/${num}.swf`, {
        method: 'GET',
      })
      return response.ok
    } catch {
      return false
    }
  }

  async preloadPetSwf(num: number): Promise<void> {
    const remoteUrl = this.getRemotePetUrl(num)

    const existing = this.cache.get(num)
    if (existing?.cached || existing?.loading) {
      return
    }

    const entry: CacheEntry = {
      url: remoteUrl,
      cached: false,
      loading: true,
    }
    this.cache.set(num, entry)
    this.updateStats()

    try {
      if (isDesktop) {
        const api = getDesktopApi()
        if (api) {
          await api.downloadPetSwf(num, remoteUrl)
        }
      } else {
        const response = await fetch(remoteUrl, {
          method: 'HEAD',
          mode: 'no-cors',
        })

        if (response.ok || response.type === 'opaque') {
          await fetch(remoteUrl, { mode: 'no-cors' })
        }
      }

      entry.cached = true
    } catch (error) {
      entry.error = (error as Error).message
      console.warn(`Failed to preload pet ${num}:`, error)
    } finally {
      entry.loading = false
      this.updateStats()
    }
  }

  async preloadAllPets(
    petNums: number[],
    onProgress?: (progress: { current: number; total: number; percent: number }) => void,
  ): Promise<void> {
    const total = petNums.length
    let completed = 0

    const uncachedNums = petNums.filter(num => !this.isCached(num))

    if (uncachedNums.length === 0) {
      console.log('All pet resources are already cached.')
      return
    }

    console.log(`Starting to preload ${uncachedNums.length}/${total} pet resources.`)

    const concurrency = 5
    const chunks: number[][] = []

    for (let i = 0; i < uncachedNums.length; i += concurrency) {
      chunks.push(uncachedNums.slice(i, i + concurrency))
    }

    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map(async num => {
          try {
            await this.preloadPetSwf(num)
          } catch (error) {
            console.warn(`Skipping pet ${num}:`, error)
          } finally {
            completed++
            onProgress?.({
              current: completed,
              total: uncachedNums.length,
              percent: Math.round((completed / uncachedNums.length) * 100),
            })
          }
        }),
      )

      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log(`Preloading complete. Successfully cached ${this.stats.cached} pet resources.`)
  }

  async resetCache() {
    if (isDesktop) {
      const api = getDesktopApi()
      if (api) {
        try {
          await api.clearPetCache()
        } catch (error) {
          console.error('Failed to clear local pet cache:', error)
        }
      }
    }

    this.cache.clear()
    this.updateStats()
    console.log('Cache has been reset.')
  }

  getCacheDetails(): Array<{ num: number; cached: boolean; loading: boolean; error?: string }> {
    return Array.from(this.cache.entries()).map(([num, entry]) => ({
      num,
      cached: entry.cached,
      loading: entry.loading,
      error: entry.error,
    }))
  }
}

export const petResourceCache = new PetResourceCache()
