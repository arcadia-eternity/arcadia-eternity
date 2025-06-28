import type { Platform, Architecture, WindowsFormat, MacOSFormat, PlatformInfo } from '@/types/download'

/**
 * 检测用户的操作系统平台
 */
export function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()

  // Windows 检测
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows'
  }

  // macOS 检测
  if (platform.includes('mac') || userAgent.includes('mac os')) {
    return 'macos'
  }

  // Linux 检测
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'linux'
  }

  // 默认返回 windows（最常见的桌面平台）
  return 'windows'
}

/**
 * 检测用户的处理器架构
 */
export function detectArchitecture(): Architecture {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()

  // Apple Silicon 检测
  if (platform.includes('mac')) {
    // 检测是否为 Apple Silicon
    // 注意：在 Apple Silicon 上运行的 Intel 应用会显示为 Intel
    if (userAgent.includes('intel')) {
      return 'x64'
    }
    // 新的 Mac 默认为 Apple Silicon
    return 'aarch64'
  }

  // ARM 架构检测
  if (platform.includes('arm') || userAgent.includes('arm')) {
    return 'aarch64'
  }

  // 64位检测
  if (
    platform.includes('x64') ||
    platform.includes('x86_64') ||
    platform.includes('amd64') ||
    userAgent.includes('x64') ||
    userAgent.includes('wow64')
  ) {
    return 'x64'
  }

  // 默认返回 x64
  return 'x64'
}

/**
 * 获取推荐的下载格式
 */
export function getRecommendedFormat(platform: Platform): WindowsFormat | MacOSFormat {
  switch (platform) {
    case 'windows':
      // NSIS 安装包更常用，体积更小
      return 'nsis'
    case 'macos':
      return 'app'
    default:
      return 'nsis'
  }
}

/**
 * 检测是否为移动设备
 */
export function isMobileDevice(): boolean {
  const userAgent = navigator.userAgent.toLowerCase()
  const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'opera mini']

  return mobileKeywords.some(keyword => userAgent.includes(keyword))
}

/**
 * 获取详细的平台信息
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = detectPlatform()
  const architecture = detectArchitecture()
  const recommendedFormat = getRecommendedFormat(platform)
  const userAgent = navigator.userAgent
  const isMobile = isMobileDevice()

  return {
    platform,
    architecture,
    recommendedFormat,
    userAgent,
    isMobile,
  }
}

/**
 * 获取平台的显示名称
 */
export function getPlatformDisplayName(platform: Platform, architecture?: Architecture): string {
  switch (platform) {
    case 'windows':
      return `Windows ${architecture === 'x64' ? '64-bit' : '32-bit'}`
    case 'macos':
      if (architecture === 'aarch64') {
        return 'macOS (Apple Silicon)'
      } else {
        return 'macOS (Intel)'
      }
    case 'linux':
      return `Linux ${architecture === 'x64' ? '64-bit' : '32-bit'}`
    default:
      return 'Unknown Platform'
  }
}

/**
 * 获取架构的显示名称
 */
export function getArchitectureDisplayName(architecture: Architecture): string {
  switch (architecture) {
    case 'x64':
      return 'Intel/AMD 64-bit'
    case 'aarch64':
    case 'arm64':
      return 'ARM 64-bit'
    default:
      return 'Unknown Architecture'
  }
}

/**
 * 获取格式的显示名称和描述
 */
export function getFormatInfo(format: WindowsFormat | MacOSFormat): {
  name: string
  description: string
  extension: string
} {
  switch (format) {
    case 'msi':
      return {
        name: 'MSI Installer',
        description: 'Windows Installer package, suitable for enterprise deployment',
        extension: '.msi',
      }
    case 'nsis':
      return {
        name: 'NSIS Installer',
        description: 'Lightweight installer, recommended for most users',
        extension: '.exe',
      }
    case 'dmg':
      return {
        name: 'DMG Image',
        description: 'macOS disk image, drag to Applications folder to install',
        extension: '.dmg',
      }
    case 'app':
      return {
        name: 'App Bundle',
        description: 'macOS application bundle (tar.gz archive), extract and drag to Applications',
        extension: '.app.tar.gz',
      }
    default:
      return {
        name: 'Unknown Format',
        description: 'Unknown file format',
        extension: '',
      }
  }
}

/**
 * 检测浏览器信息
 */
export function getBrowserInfo(): { name: string; version: string; engine: string } {
  const userAgent = navigator.userAgent

  // Chrome
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    const match = userAgent.match(/Chrome\/(\d+)/)
    return {
      name: 'Chrome',
      version: match ? match[1] : 'Unknown',
      engine: 'Blink',
    }
  }

  // Edge
  if (userAgent.includes('Edg')) {
    const match = userAgent.match(/Edg\/(\d+)/)
    return {
      name: 'Edge',
      version: match ? match[1] : 'Unknown',
      engine: 'Blink',
    }
  }

  // Firefox
  if (userAgent.includes('Firefox')) {
    const match = userAgent.match(/Firefox\/(\d+)/)
    return {
      name: 'Firefox',
      version: match ? match[1] : 'Unknown',
      engine: 'Gecko',
    }
  }

  // Safari
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(/Version\/(\d+)/)
    return {
      name: 'Safari',
      version: match ? match[1] : 'Unknown',
      engine: 'WebKit',
    }
  }

  return {
    name: 'Unknown',
    version: 'Unknown',
    engine: 'Unknown',
  }
}

/**
 * 检测网络环境（简单的地区检测）
 */
export function detectRegion(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const language = navigator.language

  // 基于时区的简单地区检测
  if (timezone.includes('Asia/Shanghai') || timezone.includes('Asia/Beijing')) {
    return 'CN'
  }

  if (timezone.includes('Asia/')) {
    return 'AS'
  }

  if (timezone.includes('Europe/')) {
    return 'EU'
  }

  if (timezone.includes('America/')) {
    return 'US'
  }

  // 基于语言的检测
  if (language.startsWith('zh-CN')) {
    return 'CN'
  }

  return 'global'
}

/**
 * 检测系统主题偏好
 */
export function getSystemTheme(): 'light' | 'dark' | 'auto' {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/**
 * 获取系统语言偏好
 */
export function getSystemLanguage(): string {
  return navigator.language || navigator.languages?.[0] || 'en-US'
}

/**
 * 综合环境检测
 */
export function getEnvironmentInfo() {
  return {
    platform: getPlatformInfo(),
    browser: getBrowserInfo(),
    region: detectRegion(),
    theme: getSystemTheme(),
    language: getSystemLanguage(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    cookieEnabled: navigator.cookieEnabled,
    javaEnabled: navigator.javaEnabled?.() || false,
  }
}
