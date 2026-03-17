import packageJson from '../../package.json'
import { getDesktopApi, isDesktop } from './env'

export interface VersionInfo {
  version: string
  buildTime: string
  commitHash: string
  environment: 'development' | 'production'
  isDesktop: boolean
}

function getBuildTime(): string {
  return import.meta.env.VITE_BUILD_TIME || new Date().toISOString()
}

function getCommitHash(): string {
  return import.meta.env.VITE_COMMIT_HASH || 'dev'
}

function getEnvironment(): 'development' | 'production' {
  return import.meta.env.PROD ? 'production' : 'development'
}

function getIsDesktop(): boolean {
  return isDesktop
}

async function getAppVersion(): Promise<string> {
  if (isDesktop) {
    try {
      const api = getDesktopApi()
      if (api) {
        return await api.getAppVersion()
      }
    } catch (error) {
      console.warn('无法获取桌面端版本信息，使用 package.json 版本:', error)
    }
  }
  return packageJson.version
}

export function getVersionInfo(): VersionInfo {
  return {
    version: packageJson.version,
    buildTime: getBuildTime(),
    commitHash: getCommitHash(),
    environment: getEnvironment(),
    isDesktop: getIsDesktop(),
  }
}

export async function getVersionInfoAsync(): Promise<VersionInfo> {
  return {
    version: await getAppVersion(),
    buildTime: getBuildTime(),
    commitHash: getCommitHash(),
    environment: getEnvironment(),
    isDesktop: getIsDesktop(),
  }
}

export function getVersionString(): string {
  const info = getVersionInfo()

  if (info.environment === 'production') {
    return `v${info.version}`
  }

  return `v${info.version}-dev.${info.commitHash.substring(0, 7)}`
}

export async function getVersionStringAsync(): Promise<string> {
  const info = await getVersionInfoAsync()

  if (info.environment === 'production') {
    return `v${info.version}`
  }

  return `v${info.version}-dev.${info.commitHash.substring(0, 7)}`
}

export function getDetailedVersionString(): string {
  const info = getVersionInfo()
  const buildDate = new Date(info.buildTime).toLocaleString('zh-CN')

  return [
    `版本: ${getVersionString()}`,
    `环境: ${info.environment === 'production' ? '生产' : '开发'}`,
    `平台: ${info.isDesktop ? 'Electron桌面版' : 'Web版'}`,
    `构建时间: ${buildDate}`,
    info.environment === 'development' ? `提交: ${info.commitHash}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function getDetailedVersionStringAsync(): Promise<string> {
  const info = await getVersionInfoAsync()
  const buildDate = new Date(info.buildTime).toLocaleString('zh-CN')
  const versionString = await getVersionStringAsync()

  return [
    `版本: ${versionString}`,
    `环境: ${info.environment === 'production' ? '生产' : '开发'}`,
    `平台: ${info.isDesktop ? 'Electron桌面版' : 'Web版'}`,
    `构建时间: ${buildDate}`,
    info.environment === 'development' ? `提交: ${info.commitHash}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

async function handleUpdateInstallation(version: string): Promise<void> {
  const api = getDesktopApi()
  if (!api) {
    throw new Error('当前环境不支持自动更新')
  }

  await ElMessageBox.confirm(`发现新版本 ${version}，是否立即下载并安装？`, '更新提示', {
    confirmButtonText: '立即更新',
    cancelButtonText: '稍后更新',
    type: 'info',
  })

  ElMessage.info('开始下载更新...')
  await api.downloadAndInstallUpdate()
}

export async function checkForUpdates(
  options: {
    isAutoCheck?: boolean
    onSuccess?: (hasUpdate: boolean, version?: string) => void
    onError?: (error: any) => void
  } = {},
): Promise<void> {
  const { isAutoCheck = false, onSuccess, onError } = options

  if (!isDesktop) {
    return
  }

  const api = getDesktopApi()
  if (!api) {
    return
  }

  try {
    console.log(isAutoCheck ? '正在自动检查更新...' : '正在检查更新...')

    const update = await api.checkForUpdates()

    if (update.hasUpdate && update.version) {
      console.log(`发现新版本: ${update.version}`)
      onSuccess?.(true, update.version)

      if (isAutoCheck) {
        const { ElNotification } = await import('element-plus')

        ElNotification({
          title: '发现新版本',
          message: `新版本 ${update.version} 已发布，点击立即更新`,
          type: 'info',
          duration: 0,
          onClick: async () => {
            try {
              await handleUpdateInstallation(update.version!)
            } catch {
              console.log('用户取消了自动更新')
            }
          },
        })
      } else {
        ElMessage.success(`发现新版本: ${update.version}`)

        try {
          await handleUpdateInstallation(update.version)
        } catch {
          ElMessage.info('已取消更新')
        }
      }
    } else {
      console.log('当前已是最新版本')
      onSuccess?.(false)

      if (!isAutoCheck) {
        ElMessage.info('当前已是最新版本')
      }
    }
  } catch (error) {
    console.error('检查更新失败:', error)
    onError?.(error)

    if (!isAutoCheck) {
      ElMessage.error('检查更新失败，请稍后重试')
    }
  }
}

export async function autoCheckForUpdates(): Promise<void> {
  if (!isDesktop) {
    return
  }

  const info = getVersionInfo()
  if (info.environment !== 'production') {
    console.log('开发环境下跳过自动更新检查')
    return
  }

  await checkForUpdates({ isAutoCheck: true })
}
