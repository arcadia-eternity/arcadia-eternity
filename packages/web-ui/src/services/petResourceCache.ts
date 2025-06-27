import { reactive } from 'vue'
import { isTauri } from '@/utils/env'

// Tauri API 状态
interface TauriApiState {
  fs: typeof import('@tauri-apps/plugin-fs') | null
  path: typeof import('@tauri-apps/api/path') | null
  http: typeof import('@tauri-apps/plugin-http') | null
  convertFileSrc: ((path: string) => string) | null
  invoke: typeof import('@tauri-apps/api/core').invoke | null
  initialized: boolean
  available: boolean
  localServerPort: number | null
}

const tauriApi: TauriApiState = {
  fs: null,
  path: null,
  http: null,
  convertFileSrc: null,
  invoke: null,
  initialized: false,
  available: false,
  localServerPort: null,
}

// 动态导入 Tauri API
async function initTauriApis(): Promise<void> {
  console.debug('initTauriApis: 开始初始化', {
    isTauri,
    hasWindow: typeof window !== 'undefined',
    hasTauriGlobal: typeof window !== 'undefined' && '__TAURI__' in window,
    viteIsTauri: import.meta.env.VITE_IS_TAURI,
    initialized: tauriApi.initialized,
  })

  if (!isTauri || tauriApi.initialized) return

  tauriApi.initialized = true

  try {
    // 导入 Tauri 2.x 插件
    const [fsModule, httpModule, pathModule, coreModule] = await Promise.allSettled([
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/plugin-http'),
      import('@tauri-apps/api/path'),
      import('@tauri-apps/api/core'),
    ])

    if (fsModule.status === 'fulfilled') {
      tauriApi.fs = fsModule.value
    }
    if (httpModule.status === 'fulfilled') {
      tauriApi.http = httpModule.value
    }
    if (pathModule.status === 'fulfilled') {
      tauriApi.path = pathModule.value
    }
    if (coreModule.status === 'fulfilled') {
      tauriApi.convertFileSrc = coreModule.value.convertFileSrc
      tauriApi.invoke = coreModule.value.invoke
    }

    tauriApi.available = !!(tauriApi.fs && tauriApi.path && tauriApi.http && tauriApi.convertFileSrc && tauriApi.invoke)

    if (tauriApi.available && tauriApi.invoke) {
      // 获取本地服务器端口
      try {
        tauriApi.localServerPort = await tauriApi.invoke<number>('get_local_server_port')
        console.log('Tauri 插件加载成功，本地服务器端口:', tauriApi.localServerPort)
      } catch (error) {
        console.warn('获取本地服务器端口失败:', error)
      }
    } else {
      console.warn('部分 Tauri 插件加载失败')
    }
  } catch (error) {
    console.warn('无法加载 Tauri API:', error)
    tauriApi.available = false
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
  private localPetDir: string | null = null

  constructor() {
    this.init()
  }

  private async init() {
    await initTauriApis()

    console.debug('PetResourceCache.init: 检查初始化条件', {
      isTauri,
      tauriApiAvailable: tauriApi.available,
      tauriApiPath: !!tauriApi.path,
      tauriApiFs: !!tauriApi.fs,
    })

    if (isTauri && tauriApi.available && tauriApi.path && tauriApi.fs) {
      try {
        console.debug('PetResourceCache.init: 开始初始化本地缓存目录')
        const appDataDirPath = await tauriApi.path.appDataDir()
        console.debug('PetResourceCache.init: appDataDir =', appDataDirPath)

        this.localPetDir = await tauriApi.path.join(appDataDirPath, 'pets')
        console.debug('PetResourceCache.init: localPetDir =', this.localPetDir)

        // 创建缓存目录
        await tauriApi.fs.mkdir(this.localPetDir, { recursive: true })
        console.log('Tauri 本地缓存目录初始化成功:', this.localPetDir)
      } catch (error) {
        console.error('初始化 Tauri 缓存目录失败:', error)
        console.error('错误详情:', {
          message: (error as Error).message,
          stack: (error as Error).stack,
          error,
        })
        this.localPetDir = null
      }
    } else if (isTauri) {
      console.warn('Tauri 插件未完全加载，本地缓存功能将被禁用', {
        available: tauriApi.available,
        path: !!tauriApi.path,
        fs: !!tauriApi.fs,
      })
    }
    this.initStats()
  }

  // 获取缓存统计信息
  getStats(): CacheStats {
    return this.stats
  }

  // 获取本地服务器端口（公共方法）
  getLocalServerPort(): number | null {
    return tauriApi.localServerPort
  }

  // 获取远程精灵资源URL（公共方法）
  getRemotePetUrl(num: number): string {
    return `https://seer2-pet-resource.yuuinih.com/public/fight/${num}.swf`
  }

  // 初始化统计信息
  async initStats() {
    if (isTauri && this.localPetDir && tauriApi.fs) {
      try {
        const entries = await tauriApi.fs.readDir(this.localPetDir)
        for (const entry of entries) {
          if (entry.name?.endsWith('.swf')) {
            const num = parseInt(entry.name.replace('.swf', ''))
            if (!isNaN(num)) {
              const url = this.getRemotePetUrl(num)
              this.cache.set(num, { url, cached: true, loading: false })
            }
          }
        }
      } catch (error) {
        console.warn('读取本地缓存目录失败:', error)
      }
    }
    this.updateStats()
  }

  // 更新统计信息
  private updateStats() {
    this.stats.total = this.cache.size
    this.stats.cached = Array.from(this.cache.values()).filter(entry => entry.cached).length
    this.stats.loading = Array.from(this.cache.values()).filter(entry => entry.loading).length
  }

  // 获取本地服务器端口（如果还没有获取到）
  private async ensureLocalServerPort(): Promise<void> {
    if (isTauri && tauriApi.invoke && !tauriApi.localServerPort) {
      try {
        tauriApi.localServerPort = await tauriApi.invoke<number>('get_local_server_port')
        if (tauriApi.localServerPort) {
          console.log('获取到本地服务器端口:', tauriApi.localServerPort)
        }
      } catch (error) {
        console.warn('获取本地服务器端口失败:', error)
      }
    }
  }

  // 获取最终的精灵资源URL
  async getPetSwfUrl(num: number): Promise<string> {
    const remoteUrl = this.getRemotePetUrl(num)

    console.debug(`getPetSwfUrl(${num}): 开始检查`, {
      isTauri,
      localPetDir: this.localPetDir,
      tauriApiPath: !!tauriApi.path,
      tauriApiFs: !!tauriApi.fs,
      tauriApiAvailable: tauriApi.available,
      localServerPort: tauriApi.localServerPort,
    })

    if (isTauri && this.localPetDir && tauriApi.path && tauriApi.fs) {
      // 确保我们有端口信息
      await this.ensureLocalServerPort()

      if (tauriApi.localServerPort) {
        try {
          const localPath = await tauriApi.path.join(this.localPetDir, `${num}.swf`)
          const fileExists = await tauriApi.fs.exists(localPath)
          console.debug(`getPetSwfUrl(${num}): 本地文件检查`, {
            localPath,
            fileExists,
          })

          if (fileExists) {
            // 在 Tauri 环境中，通过本地 HTTP 服务器提供文件
            const localHttpUrl = `http://localhost:${tauriApi.localServerPort}/cache/pets/${num}.swf`
            console.log(`Pet ${num}: 使用本地 HTTP 服务器 URL: ${localHttpUrl}`)
            return localHttpUrl
          }
        } catch (error) {
          console.error(`Error accessing local file for pet ${num}:`, error)
        }
      } else {
        console.warn(`getPetSwfUrl(${num}): 本地服务器端口未获取到`)
      }
    }

    // 降级到远程 URL
    console.log(`Pet ${num}: 使用远程 URL: ${remoteUrl}`)
    return remoteUrl
  }

  // 检查资源是否已缓存
  isCached(num: number): boolean {
    const entry = this.cache.get(num)
    return entry?.cached || false
  }

  // 检查本地文件是否真的存在（仅在 Tauri 环境中有效）
  async isLocalFileExists(num: number): Promise<boolean> {
    if (!isTauri || !this.localPetDir || !tauriApi.path || !tauriApi.fs) {
      return false
    }

    try {
      const localPath = await tauriApi.path.join(this.localPetDir, `${num}.swf`)
      return await tauriApi.fs.exists(localPath)
    } catch (error) {
      console.warn(`检查本地文件失败 (pet ${num}):`, error)
      return false
    }
  }

  // 预加载/预缓存单个精灵资源
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
      if (isTauri && this.localPetDir && tauriApi.http && tauriApi.path && tauriApi.fs) {
        // Tauri environment: download and save locally
        // 文件将通过本地 HTTP 服务器 (localhost:8103) 提供给 Ruffle
        const response = await fetch(remoteUrl)

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer()
          const localPath = await tauriApi.path.join(this.localPetDir, `${num}.swf`)
          await tauriApi.fs.writeFile(localPath, new Uint8Array(arrayBuffer))
          console.debug(`Pet ${num} 已下载到本地缓存，将通过本地 HTTP 服务器提供`)
        } else {
          throw new Error(`Failed to fetch pet ${num}: ${response.status}`)
        }
      } else {
        // Web environment: use fetch to populate browser cache
        const response = await fetch(remoteUrl, {
          method: 'HEAD',
          mode: 'no-cors',
        })

        if (response.ok || response.type === 'opaque') {
          await fetch(remoteUrl, { mode: 'no-cors' })
        }
        console.debug(`Pet ${num} precached successfully.`)
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

  // 预缓存所有精灵资源
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

    const concurrency = 5 // Adjust concurrency as needed
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

  // 重置缓存状态记录（在Tauri中会删除本地文件）
  async resetCache() {
    if (isTauri && this.localPetDir && tauriApi.fs) {
      try {
        await tauriApi.fs.remove(this.localPetDir, { recursive: true })
        await tauriApi.fs.mkdir(this.localPetDir, { recursive: true })
      } catch (error) {
        console.error('Failed to clear local pet cache:', error)
      }
    }
    this.cache.clear()
    this.updateStats()
    console.log('Cache has been reset.')
  }

  // 获取缓存详情
  getCacheDetails(): Array<{ num: number; cached: boolean; loading: boolean; error?: string }> {
    return Array.from(this.cache.entries()).map(([num, entry]) => ({
      num,
      cached: entry.cached,
      loading: entry.loading,
      error: entry.error,
    }))
  }
}

// 导出单例实例
export const petResourceCache = new PetResourceCache()
