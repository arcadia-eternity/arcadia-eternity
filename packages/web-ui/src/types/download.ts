/**
 * 下载源接口定义
 */
export interface DownloadSource {
  /** 源的唯一标识符 */
  id: string
  /** 源的显示名称 */
  name: string
  /** 基础URL */
  baseUrl: string
  /** 优先级，数字越小优先级越高 */
  priority: number
  /** 支持的地区代码 */
  regions?: string[]
  /** 用于检测可用性的URL */
  checkUrl?: string
  /** 是否启用 */
  enabled?: boolean
  /** 描述信息 */
  description?: string
}

/**
 * 平台和架构类型
 */
export type Platform = 'windows' | 'macos' | 'linux'
export type Architecture = 'x64' | 'aarch64' | 'arm64'
export type WindowsFormat = 'msi' | 'nsis'
export type MacOSFormat = 'dmg' | 'app'

/**
 * 下载资源定义
 */
export interface DownloadAsset {
  /** 文件名 */
  filename: string
  /** 文件大小（字节） */
  size?: number
  /** 文件哈希值 */
  hash?: string
  /** 下载次数 */
  downloadCount?: number
}

/**
 * 平台特定的下载资源
 */
export interface PlatformAssets {
  windows: {
    msi: DownloadAsset
    nsis: DownloadAsset
  }
  macos: {
    intel: DownloadAsset
    apple_silicon: DownloadAsset
  }
  linux?: {
    deb?: DownloadAsset
    rpm?: DownloadAsset
    appimage?: DownloadAsset
  }
}

/**
 * 完整的下载配置
 */
export interface DownloadConfig {
  /** 版本号 */
  version: string
  /** 发布日期 */
  releaseDate?: string
  /** 发布说明 */
  releaseNotes?: string
  /** 可用的下载源 */
  sources: DownloadSource[]
  /** 各平台的资源文件 */
  assets: PlatformAssets
  /** 是否为预发布版本 */
  prerelease?: boolean
  /** 最小系统要求 */
  systemRequirements?: {
    windows?: string
    macos?: string
    linux?: string
  }
}

/**
 * 下载选项
 */
export interface DownloadOptions {
  /** 指定平台 */
  platform?: Platform
  /** 指定架构 */
  architecture?: Architecture
  /** 指定格式 */
  format?: WindowsFormat | MacOSFormat
  /** 是否强制使用特定源 */
  forceSource?: string
  /** 是否启用降级策略 */
  enableFallback?: boolean
}

/**
 * 下载结果
 */
export interface DownloadResult {
  /** 是否成功 */
  success: boolean
  /** 使用的下载源 */
  source?: DownloadSource
  /** 下载URL */
  url?: string
  /** 错误信息 */
  error?: string
  /** 降级次数 */
  fallbackCount?: number
}

/**
 * 平台检测结果
 */
export interface PlatformInfo {
  /** 操作系统 */
  platform: Platform
  /** 架构 */
  architecture: Architecture
  /** 推荐的下载格式 */
  recommendedFormat: WindowsFormat | MacOSFormat
  /** 用户代理字符串 */
  userAgent: string
  /** 是否为移动设备 */
  isMobile: boolean
}

/**
 * 下载源配置模板
 */
export interface DownloadSourceTemplate {
  /** 源ID */
  id: string
  /** 显示名称 */
  name: string
  /** URL生成函数 */
  baseUrl: (version: string) => string
  /** 优先级 */
  priority: number
  /** 支持的地区 */
  regions?: string[]
  /** 检测URL */
  checkUrl?: string
  /** 描述 */
  description?: string
}

/**
 * 下载统计信息
 */
export interface DownloadStats {
  /** 总下载次数 */
  totalDownloads: number
  /** 各平台下载次数 */
  platformStats: Record<Platform, number>
  /** 各源的使用次数 */
  sourceStats: Record<string, number>
  /** 最后更新时间 */
  lastUpdated: string
}
