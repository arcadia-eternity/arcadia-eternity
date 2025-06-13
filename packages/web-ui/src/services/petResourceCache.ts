import { reactive } from 'vue'

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

  // 获取缓存统计信息
  getStats(): CacheStats {
    return this.stats
  }

  // 初始化统计信息
  initStats() {
    this.updateStats()
  }

  // 更新统计信息
  private updateStats() {
    this.stats.total = this.cache.size
    this.stats.cached = Array.from(this.cache.values()).filter(entry => entry.cached).length
    this.stats.loading = Array.from(this.cache.values()).filter(entry => entry.loading).length
  }

  // 获取精灵资源URL
  private getPetUrl(num: number): string {
    return `https://seer2-pet-resource.yuuinih.com/public/fight/${num}.swf`
  }

  // 检查资源是否已缓存
  isCached(num: number): boolean {
    const entry = this.cache.get(num)
    return entry?.cached || false
  }

  // 预缓存单个精灵资源
  async precachePet(num: number): Promise<void> {
    const url = this.getPetUrl(num)

    // 如果已经缓存或正在加载，直接返回
    const existing = this.cache.get(num)
    if (existing?.cached || existing?.loading) {
      return
    }

    // 创建缓存条目
    const entry: CacheEntry = {
      url,
      cached: false,
      loading: true,
    }
    this.cache.set(num, entry)
    this.updateStats()

    try {
      // 使用简单的 fetch 预加载资源
      const response = await fetch(url, {
        method: 'HEAD', // 只获取头部信息，不下载完整内容
        mode: 'no-cors', // 允许跨域请求
      })

      // 如果 HEAD 请求成功，再用 GET 请求实际缓存资源
      if (response.ok || response.type === 'opaque') {
        await fetch(url, {
          mode: 'no-cors',
        })
      }

      // 标记为已缓存
      entry.cached = true
      entry.loading = false
      console.debug(`精灵 ${num} 预缓存成功`)
    } catch (error) {
      entry.loading = false
      entry.error = (error as Error).message
      console.warn(`精灵 ${num} 预缓存失败:`, error)
      // 不抛出错误，让批量预缓存继续进行
    } finally {
      this.updateStats()
    }
  }

  // 预缓存所有精灵资源
  async precacheAll(
    petNums: number[],
    onProgress?: (progress: { current: number; total: number; percent: number }) => void,
  ): Promise<void> {
    const total = petNums.length
    let completed = 0

    // 过滤掉已经缓存的精灵
    const uncachedNums = petNums.filter(num => !this.isCached(num))

    if (uncachedNums.length === 0) {
      console.log('所有精灵资源已缓存')
      return
    }

    console.log(`开始预缓存 ${uncachedNums.length}/${total} 个精灵资源`)

    // 并发控制，避免同时加载太多资源
    const concurrency = 2 // 降低并发数以减少资源消耗
    const chunks: number[][] = []

    for (let i = 0; i < uncachedNums.length; i += concurrency) {
      chunks.push(uncachedNums.slice(i, i + concurrency))
    }

    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map(async num => {
          try {
            await this.precachePet(num)
          } catch (error) {
            console.warn(`跳过精灵 ${num}:`, error)
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

      // 在每个批次之间稍作停顿，避免过度占用资源
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log(`预缓存完成，成功缓存 ${this.stats.cached} 个精灵资源`)
  }

  // 重置缓存状态记录（不会清除浏览器实际缓存）
  resetCacheStatus() {
    this.cache.clear()
    this.updateStats()
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
