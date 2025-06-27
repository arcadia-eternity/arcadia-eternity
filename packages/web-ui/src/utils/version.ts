/**
 * 版本信息工具
 */

// 从package.json获取版本信息
import packageJson from '../../package.json'

export interface VersionInfo {
  version: string
  buildTime: string
  commitHash: string
  environment: 'development' | 'production'
  isTauri: boolean
}

/**
 * 获取构建时间
 */
function getBuildTime(): string {
  // 在构建时会被替换为实际的构建时间
  return import.meta.env.VITE_BUILD_TIME || new Date().toISOString()
}

/**
 * 获取commit hash
 */
function getCommitHash(): string {
  // 在构建时会被替换为实际的commit hash
  return import.meta.env.VITE_COMMIT_HASH || 'dev'
}

/**
 * 判断是否为生产环境
 */
function getEnvironment(): 'development' | 'production' {
  return import.meta.env.PROD ? 'production' : 'development'
}

/**
 * 判断是否为Tauri环境
 */
function getIsTauri(): boolean {
  return import.meta.env.VITE_IS_TAURI === true
}

/**
 * 获取完整的版本信息
 */
export function getVersionInfo(): VersionInfo {
  return {
    version: packageJson.version,
    buildTime: getBuildTime(),
    commitHash: getCommitHash(),
    environment: getEnvironment(),
    isTauri: getIsTauri(),
  }
}

/**
 * 获取版本显示字符串
 */
export function getVersionString(): string {
  const info = getVersionInfo()
  
  if (info.environment === 'production') {
    return `v${info.version}`
  } else {
    return `v${info.version}-dev.${info.commitHash.substring(0, 7)}`
  }
}

/**
 * 获取详细的版本信息字符串
 */
export function getDetailedVersionString(): string {
  const info = getVersionInfo()
  const buildDate = new Date(info.buildTime).toLocaleString('zh-CN')
  
  return [
    `版本: ${getVersionString()}`,
    `环境: ${info.environment === 'production' ? '生产' : '开发'}`,
    `平台: ${info.isTauri ? 'Tauri桌面版' : 'Web版'}`,
    `构建时间: ${buildDate}`,
    info.environment === 'development' ? `提交: ${info.commitHash}` : null,
  ].filter(Boolean).join('\n')
}
