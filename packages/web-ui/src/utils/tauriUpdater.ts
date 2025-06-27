import { check, Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'

export interface UpdateInfo {
  version: string
  currentVersion: string
  date: string
  body: string
}

export interface UpdateProgress {
  downloaded: number
  total: number
  percentage: number
  status: 'checking' | 'downloading' | 'installing' | 'ready' | 'complete' | 'error'
}

export type UpdateProgressCallback = (progress: UpdateProgress) => void

/**
 * Tauri 内置更新管理器
 * 使用 Tauri 的内置 updater 插件进行自动更新
 */
export class TauriUpdater {
  private currentUpdate: Update | null = null

  /**
   * 检查是否有新版本
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      const currentVersion = await getVersion()
      const update = await check()
      
      if (update) {
        this.currentUpdate = update
        return {
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date || '',
          body: update.body || ''
        }
      }
      
      return null
    } catch (error) {
      console.error('检查更新失败:', error)
      throw error
    }
  }

  /**
   * 下载并安装更新
   */
  async downloadAndInstall(onProgress?: UpdateProgressCallback): Promise<void> {
    if (!this.currentUpdate) {
      throw new Error('没有可用的更新')
    }

    try {
      if (onProgress) {
        onProgress({
          downloaded: 0,
          total: 0,
          percentage: 0,
          status: 'downloading'
        })
      }

      let downloaded = 0
      let contentLength = 0

      await this.currentUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0
            if (onProgress) {
              onProgress({
                downloaded: 0,
                total: contentLength,
                percentage: 0,
                status: 'downloading'
              })
            }
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            const percentage = contentLength > 0 ? (downloaded / contentLength) * 100 : 0
            if (onProgress) {
              onProgress({
                downloaded,
                total: contentLength,
                percentage,
                status: 'downloading'
              })
            }
            break
          case 'Finished':
            if (onProgress) {
              onProgress({
                downloaded: contentLength,
                total: contentLength,
                percentage: 100,
                status: 'installing'
              })
            }
            break
        }
      })

      if (onProgress) {
        onProgress({
          downloaded: contentLength,
          total: contentLength,
          percentage: 100,
          status: 'complete'
        })
      }

      // 清除当前更新引用
      this.currentUpdate = null
    } catch (error) {
      console.error('下载安装更新失败:', error)
      if (onProgress) {
        onProgress({
          downloaded: 0,
          total: 0,
          percentage: 0,
          status: 'error'
        })
      }
      throw error
    }
  }

  /**
   * 重启应用
   */
  async restartApp(): Promise<void> {
    try {
      await relaunch()
    } catch (error) {
      console.error('重启应用失败:', error)
      throw error
    }
  }

  /**
   * 获取更新说明
   */
  getUpdateInstructions(): string {
    return '更新将自动下载并安装，完成后应用将重启。'
  }

  /**
   * 检查是否有待安装的更新
   */
  hasPendingUpdate(): boolean {
    return this.currentUpdate !== null
  }

  /**
   * 清除待安装的更新
   */
  clearPendingUpdate(): void {
    this.currentUpdate = null
  }
}

// 导出单例实例
export const tauriUpdater = new TauriUpdater()
