import type {
  DownloadSource,
  DownloadConfig,
  DownloadOptions,
  DownloadResult,
  Platform,
  Architecture,
  WindowsFormat,
  MacOSFormat,
  PlatformAssets
} from '@/types/download'

/**
 * 下载管理器核心类
 * 负责管理下载源、生成下载链接和处理下载逻辑
 */
export class DownloadManager {
  private sources: DownloadSource[] = []
  private version: string
  private assets: PlatformAssets

  constructor(version: string, assets: PlatformAssets) {
    this.version = version
    this.assets = assets
  }

  /**
   * 添加下载源
   */
  addSource(source: DownloadSource): void {
    // 检查是否已存在相同ID的源
    const existingIndex = this.sources.findIndex(s => s.id === source.id)
    if (existingIndex >= 0) {
      this.sources[existingIndex] = source
    } else {
      this.sources.push(source)
    }
    
    // 按优先级排序
    this.sources.sort((a, b) => a.priority - b.priority)
  }

  /**
   * 移除下载源
   */
  removeSource(sourceId: string): boolean {
    const initialLength = this.sources.length
    this.sources = this.sources.filter(s => s.id !== sourceId)
    return this.sources.length < initialLength
  }

  /**
   * 获取所有下载源
   */
  getSources(): DownloadSource[] {
    return [...this.sources].filter(s => s.enabled !== false)
  }

  /**
   * 获取指定ID的下载源
   */
  getSource(sourceId: string): DownloadSource | undefined {
    return this.sources.find(s => s.id === sourceId)
  }

  /**
   * 启用/禁用下载源
   */
  toggleSource(sourceId: string, enabled: boolean): boolean {
    const source = this.sources.find(s => s.id === sourceId)
    if (source) {
      source.enabled = enabled
      return true
    }
    return false
  }

  /**
   * 生成下载URL
   */
  generateDownloadUrl(
    sourceId: string,
    platform: Platform,
    architecture: Architecture,
    format?: WindowsFormat | MacOSFormat
  ): string | null {
    const source = this.getSource(sourceId)
    if (!source) return null

    const filename = this.getAssetFilename(platform, architecture, format)
    if (!filename) return null

    return `${source.baseUrl}/${filename}`
  }

  /**
   * 获取所有可用的下载链接
   */
  getDownloadUrls(
    platform: Platform,
    architecture: Architecture,
    format?: WindowsFormat | MacOSFormat
  ): Array<{ source: DownloadSource; url: string }> {
    const filename = this.getAssetFilename(platform, architecture, format)
    if (!filename) return []

    return this.getSources().map(source => ({
      source,
      url: `${source.baseUrl}/${filename}`
    }))
  }

  /**
   * 根据平台和架构获取资源文件名
   */
  private getAssetFilename(
    platform: Platform,
    architecture: Architecture,
    format?: WindowsFormat | MacOSFormat
  ): string | null {
    switch (platform) {
      case 'windows':
        const windowsFormat = (format as WindowsFormat) || 'nsis'
        return this.assets.windows[windowsFormat]?.filename || null

      case 'macos':
        if (architecture === 'aarch64' || architecture === 'arm64') {
          return this.assets.macos.apple_silicon?.filename || null
        } else {
          return this.assets.macos.intel?.filename || null
        }

      case 'linux':
        // 预留Linux支持
        return null

      default:
        return null
    }
  }

  /**
   * 检测下载源可用性
   */
  async checkSourceAvailability(sourceId: string): Promise<boolean> {
    const source = this.getSource(sourceId)
    if (!source || !source.checkUrl) return true

    try {
      const response = await fetch(source.checkUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache'
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 检测所有源的可用性
   */
  async checkAllSourcesAvailability(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    
    await Promise.all(
      this.sources.map(async source => {
        results[source.id] = await this.checkSourceAvailability(source.id)
      })
    )

    return results
  }

  /**
   * 获取最佳下载源
   */
  async getBestSource(region?: string): Promise<DownloadSource | null> {
    const availableSources = this.getSources()
    
    // 如果指定了地区，优先选择支持该地区的源
    if (region) {
      const regionalSources = availableSources.filter(
        s => !s.regions || s.regions.includes(region) || s.regions.includes('global')
      )
      if (regionalSources.length > 0) {
        // 检测可用性并返回第一个可用的
        for (const source of regionalSources) {
          if (await this.checkSourceAvailability(source.id)) {
            return source
          }
        }
      }
    }

    // 按优先级检测可用性
    for (const source of availableSources) {
      if (await this.checkSourceAvailability(source.id)) {
        return source
      }
    }

    // 如果都不可用，返回第一个源作为降级
    return availableSources[0] || null
  }

  /**
   * 执行智能下载
   */
  async smartDownload(options: DownloadOptions = {}): Promise<DownloadResult> {
    const {
      platform,
      architecture,
      format,
      forceSource,
      enableFallback = true
    } = options

    if (!platform || !architecture) {
      return {
        success: false,
        error: 'Platform and architecture are required'
      }
    }

    let fallbackCount = 0
    let lastError = ''

    // 如果强制使用特定源
    if (forceSource) {
      const url = this.generateDownloadUrl(forceSource, platform, architecture, format)
      const source = this.getSource(forceSource)
      
      if (url && source) {
        try {
          window.open(url, '_blank')
          return { success: true, source, url }
        } catch (error) {
          lastError = `Failed to open ${forceSource}: ${error}`
        }
      }
    }

    // 获取所有可用的下载链接
    const downloadUrls = this.getDownloadUrls(platform, architecture, format)
    
    if (downloadUrls.length === 0) {
      return {
        success: false,
        error: 'No download URLs available for the specified platform'
      }
    }

    // 尝试按优先级下载
    for (const { source, url } of downloadUrls) {
      try {
        // 检测源可用性
        if (source.checkUrl && !(await this.checkSourceAvailability(source.id))) {
          fallbackCount++
          continue
        }

        window.open(url, '_blank')
        return {
          success: true,
          source,
          url,
          fallbackCount
        }
      } catch (error) {
        lastError = `Failed to download from ${source.name}: ${error}`
        fallbackCount++
        
        if (!enableFallback) break
      }
    }

    return {
      success: false,
      error: lastError || 'All download sources failed',
      fallbackCount
    }
  }

  /**
   * 获取下载配置
   */
  getConfig(): DownloadConfig {
    return {
      version: this.version,
      sources: this.getSources(),
      assets: this.assets
    }
  }

  /**
   * 更新版本
   */
  updateVersion(version: string): void {
    this.version = version
    // 更新所有源的baseUrl
    this.sources.forEach(source => {
      if (source.baseUrl.includes(this.version)) {
        source.baseUrl = source.baseUrl.replace(/v[\d.]+/, `v${version}`)
      }
    })
  }
}
