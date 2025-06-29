/**
 * 版本信息工具
 */

// 从package.json获取版本信息
import packageJson from '../../package.json'
import { isTauri } from './env'

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
 * 获取版本号
 * 在 Tauri 环境下优先使用 Tauri 的版本信息
 */
async function getAppVersion(): Promise<string> {
  if (isTauri) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      return await getVersion()
    } catch (error) {
      console.warn('无法获取 Tauri 版本信息，使用 package.json 版本:', error)
    }
  }
  return packageJson.version
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
 * 获取完整的版本信息（异步版本，支持 Tauri）
 */
export async function getVersionInfoAsync(): Promise<VersionInfo> {
  return {
    version: await getAppVersion(),
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
 * 获取版本显示字符串（异步版本，支持 Tauri）
 */
export async function getVersionStringAsync(): Promise<string> {
  const info = await getVersionInfoAsync()

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
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 获取详细的版本信息字符串（异步版本，支持 Tauri）
 */
export async function getDetailedVersionStringAsync(): Promise<string> {
  const info = await getVersionInfoAsync()
  const buildDate = new Date(info.buildTime).toLocaleString('zh-CN')
  const versionString = await getVersionStringAsync()

  return [
    `版本: ${versionString}`,
    `环境: ${info.environment === 'production' ? '生产' : '开发'}`,
    `平台: ${info.isTauri ? 'Tauri桌面版' : 'Web版'}`,
    `构建时间: ${buildDate}`,
    info.environment === 'development' ? `提交: ${info.commitHash}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 处理更新安装流程
 */
async function handleUpdateInstallation(update: any): Promise<void> {
  await ElMessageBox.confirm(`发现新版本 ${update.version}，是否立即下载并安装？`, '更新提示', {
    confirmButtonText: '立即更新',
    cancelButtonText: '稍后更新',
    type: 'info',
  })

  // 开始下载和安装更新
  ElMessage.info('开始下载更新...')
  await update.downloadAndInstall()

  // 重启应用
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

/**
 * 通用的更新检查函数
 * @param options 检查选项
 */
export async function checkForUpdates(
  options: {
    /** 是否为自动检查 */
    isAutoCheck?: boolean
    /** 成功回调 */
    onSuccess?: (hasUpdate: boolean, version?: string) => void
    /** 错误回调 */
    onError?: (error: any) => void
  } = {},
): Promise<void> {
  const { isAutoCheck = false, onSuccess, onError } = options

  // 只在Tauri环境下执行
  if (!isTauri) {
    return
  }

  try {
    console.log(isAutoCheck ? '正在自动检查更新...' : '正在检查更新...')

    // 动态导入Tauri API
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()

    if (update) {
      console.log(`发现新版本: ${update.version}`)
      onSuccess?.(true, update.version)

      if (isAutoCheck) {
        // 自动检查：显示通知
        const { ElNotification } = await import('element-plus')

        ElNotification({
          title: '发现新版本',
          message: `新版本 ${update.version} 已发布，点击立即更新`,
          type: 'info',
          duration: 0, // 不自动关闭
          onClick: async () => {
            try {
              await handleUpdateInstallation(update)
            } catch (cancelError) {
              // 用户取消更新
              console.log('用户取消了自动更新')
            }
          },
        })
      } else {
        ElMessage.success(`发现新版本: ${update.version}`)

        try {
          await handleUpdateInstallation(update)
        } catch (cancelError) {
          // 用户取消更新
          ElMessage.info('已取消更新')
        }
      }
    } else {
      console.log('当前已是最新版本')
      onSuccess?.(false)

      if (!isAutoCheck) {
        // 手动检查时显示"已是最新版本"消息
        ElMessage.info('当前已是最新版本')
      }
    }
  } catch (error) {
    console.error('检查更新失败:', error)
    onError?.(error)

    if (!isAutoCheck) {
      // 手动检查时显示错误消息
      ElMessage.error('检查更新失败，请稍后重试')
    }
    // 自动检查失败时不显示错误消息，避免打扰用户
  }
}

/**
 * 自动检查更新（仅在Tauri环境下且为生产环境时执行）
 * 静默检查，如果有更新则显示通知
 */
export async function autoCheckForUpdates(): Promise<void> {
  // 只在Tauri环境下执行
  if (!isTauri) {
    return
  }

  // 只在生产环境下自动检查更新
  const info = getVersionInfo()
  if (info.environment !== 'production') {
    console.log('开发环境下跳过自动更新检查')
    return
  }

  await checkForUpdates({ isAutoCheck: true })
}
