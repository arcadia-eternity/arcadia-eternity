import type { DownloadSourceTemplate, PlatformAssets } from '@/types/download'

/**
 * 下载源配置模板
 */
export const downloadSourceTemplates: Record<string, DownloadSourceTemplate> = {
  github: {
    id: 'github',
    name: 'GitHub Releases',
    baseUrl: (version: string) =>
      `https://github.com/arcadia-eternity/arcadia-eternity/releases/download/arcadia-eternity-v${version}`,
    priority: 1,
    regions: ['global'],
    checkUrl: 'https://api.github.com',
    description: 'Official GitHub releases, globally available',
  },

  // 预留的自定义 CDN 配置
  customCdn: {
    id: 'custom-cdn',
    name: 'Custom CDN',
    baseUrl: (version: string) => `https://cdn.yourdomain.com/releases/arcadia-eternity-v${version}`,
    priority: 0,
    regions: ['CN', 'AS'],
    checkUrl: 'https://cdn.yourdomain.com/health',
    description: 'Custom CDN optimized for China and Asia',
  },
}

/**
 * 默认激活的下载源配置
 */
export const defaultActiveSources = {
  production: ['github'],
  development: ['github'],
  china: ['custom-cdn', 'github'],
  global: ['github'],
}

/**
 * 根据环境获取激活的源
 */
export function getActiveSourcesForEnvironment(env: string = 'production'): string[] {
  return defaultActiveSources[env as keyof typeof defaultActiveSources] || defaultActiveSources.production
}

/**
 * 根据地区获取推荐的源
 */
export function getRecommendedSourcesForRegion(region: string): string[] {
  const regionMap: Record<string, string[]> = {
    CN: ['custom-cdn', 'github'],
    AS: ['custom-cdn', 'github'],
    EU: ['github'],
    US: ['github'],
    global: ['github'],
  }

  return regionMap[region] || regionMap.global
}

/**
 * 生成当前版本的资源配置
 */
export function generateAssetConfig(version: string): PlatformAssets {
  return {
    windows: {
      msi: {
        filename: `arcadia-eternity-client_${version}_x64_en-US.msi`,
        size: 0, // 实际大小需要从构建过程中获取
        hash: '', // 实际哈希值需要从构建过程中获取
      },
      nsis: {
        filename: `arcadia-eternity-client_${version}_x64-setup.exe`,
        size: 0,
        hash: '',
      },
    },
    macos: {
      intel: {
        filename: `arcadia-eternity-client_x64.app.tar.gz`,
        size: 0,
        hash: '',
      },
      apple_silicon: {
        filename: `arcadia-eternity-client_aarch64.app.tar.gz`,
        size: 0,
        hash: '',
      },
    },
    linux: {
      deb: {
        filename: `arcadia-eternity-client_${version}_amd64.deb`,
        size: 0,
        hash: '',
      },
      rpm: {
        filename: `arcadia-eternity-client_${version}_x86_64.rpm`,
        size: 0,
        hash: '',
      },
      appimage: {
        filename: `arcadia-eternity-client_${version}_x86_64.AppImage`,
        size: 0,
        hash: '',
      },
    },
  }
}

/**
 * 下载源配置管理器
 */
export class DownloadSourceConfig {
  private static instance: DownloadSourceConfig
  private activeSources: string[] = []
  private customSources: Record<string, DownloadSourceTemplate> = {}

  private constructor() {
    this.loadFromEnvironment()
  }

  static getInstance(): DownloadSourceConfig {
    if (!DownloadSourceConfig.instance) {
      DownloadSourceConfig.instance = new DownloadSourceConfig()
    }
    return DownloadSourceConfig.instance
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnvironment(): void {
    // 从环境变量读取激活的源
    const envSources = import.meta.env.VITE_DOWNLOAD_SOURCES
    if (envSources) {
      this.activeSources = envSources.split(',').map((s: string) => s.trim())
    } else {
      // 根据环境自动选择
      const env = import.meta.env.MODE
      this.activeSources = getActiveSourcesForEnvironment(env)
    }

    // 从环境变量读取自定义CDN配置
    const customCdnUrl = import.meta.env.VITE_CDN_BASE_URL
    if (customCdnUrl) {
      this.customSources['custom-cdn'] = {
        ...downloadSourceTemplates['custom-cdn'],
        baseUrl: (version: string) => `${customCdnUrl}/v${version}`,
      }
    }
  }

  /**
   * 获取激活的源列表
   */
  getActiveSources(): string[] {
    return [...this.activeSources]
  }

  /**
   * 设置激活的源
   */
  setActiveSources(sources: string[]): void {
    this.activeSources = sources
  }

  /**
   * 添加激活的源
   */
  addActiveSource(sourceId: string): void {
    if (!this.activeSources.includes(sourceId)) {
      this.activeSources.push(sourceId)
    }
  }

  /**
   * 移除激活的源
   */
  removeActiveSource(sourceId: string): void {
    this.activeSources = this.activeSources.filter(id => id !== sourceId)
  }

  /**
   * 获取源模板
   */
  getSourceTemplate(sourceId: string): DownloadSourceTemplate | undefined {
    return this.customSources[sourceId] || downloadSourceTemplates[sourceId]
  }

  /**
   * 获取所有可用的源模板
   */
  getAllSourceTemplates(): Record<string, DownloadSourceTemplate> {
    return {
      ...downloadSourceTemplates,
      ...this.customSources,
    }
  }

  /**
   * 添加自定义源
   */
  addCustomSource(sourceId: string, template: DownloadSourceTemplate): void {
    this.customSources[sourceId] = template
  }

  /**
   * 移除自定义源
   */
  removeCustomSource(sourceId: string): void {
    delete this.customSources[sourceId]
    this.removeActiveSource(sourceId)
  }
}
