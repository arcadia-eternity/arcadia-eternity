import { getVersion } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-shell'

export interface DMGUpdateInfo {
  version: string
  date: string
  body: string
  downloadUrl: string
  size: number
}

export interface DMGUpdateProgress {
  downloaded: number
  total: number
  percentage: number
  status: 'checking' | 'downloading' | 'ready' | 'complete' | 'error'
}

export type DMGUpdateProgressCallback = (progress: DMGUpdateProgress) => void

/**
 * DMG 更新管理器
 * 引导用户下载新版本的 DMG 安装包
 */
export class DMGUpdater {
  private readonly githubRepo = 'yuuinih/test_battle'
  
  /**
   * 检查是否有新版本
   */
  async checkForUpdates(): Promise<DMGUpdateInfo | null> {
    try {
      const currentVersion = await getVersion()
      const latestRelease = await this.getLatestRelease()
      
      if (latestRelease && this.isNewerVersion(latestRelease.tag_name, currentVersion)) {
        const downloadUrl = this.getDownloadUrl(latestRelease)
        const size = await this.getFileSize(downloadUrl)
        
        return {
          version: latestRelease.tag_name.replace('v', ''),
          date: latestRelease.published_at || '',
          body: latestRelease.body || '',
          downloadUrl,
          size
        }
      }
      
      return null
    } catch (error) {
      console.error('检查更新失败:', error)
      throw error
    }
  }

  /**
   * 打开下载页面
   */
  async openDownloadPage(updateInfo: DMGUpdateInfo): Promise<void> {
    try {
      // 打开GitHub Release页面让用户手动下载
      const releaseUrl = `https://github.com/${this.githubRepo}/releases/tag/v${updateInfo.version}`
      await open(releaseUrl)
    } catch (error) {
      console.error('打开下载页面失败:', error)
      throw error
    }
  }

  /**
   * 直接下载DMG文件
   */
  async downloadDMG(updateInfo: DMGUpdateInfo): Promise<void> {
    try {
      await open(updateInfo.downloadUrl)
    } catch (error) {
      console.error('下载失败:', error)
      throw error
    }
  }

  /**
   * 获取最新发布信息
   */
  private async getLatestRelease(): Promise<any> {
    const response = await fetch(`https://api.github.com/repos/${this.githubRepo}/releases/latest`)
    if (!response.ok) {
      throw new Error(`获取发布信息失败: ${response.statusText}`)
    }
    return await response.json()
  }

  /**
   * 获取下载链接
   */
  private getDownloadUrl(release: any): string {
    const assets = release.assets || []
    
    // 查找 DMG 文件
    const dmgAsset = assets.find((asset: any) => 
      asset.name.includes('.dmg') && 
      (asset.name.includes('aarch64') || asset.name.includes('x64'))
    )
    
    if (!dmgAsset) {
      throw new Error('找不到适合的 DMG 下载文件')
    }

    return dmgAsset.browser_download_url
  }

  /**
   * 获取文件大小
   */
  private async getFileSize(url: string): Promise<number> {
    try {
      const response = await fetch(url, { method: 'HEAD' })
      const contentLength = response.headers.get('content-length')
      return contentLength ? parseInt(contentLength) : 0
    } catch {
      return 0
    }
  }

  /**
   * 比较版本号
   */
  private isNewerVersion(newVersion: string, currentVersion: string): boolean {
    const cleanNew = newVersion.replace('v', '')
    const cleanCurrent = currentVersion.replace('v', '')
    
    const newParts = cleanNew.split('.').map(Number)
    const currentParts = cleanCurrent.split('.').map(Number)
    
    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
      const newPart = newParts[i] || 0
      const currentPart = currentParts[i] || 0
      
      if (newPart > currentPart) return true
      if (newPart < currentPart) return false
    }
    
    return false
  }

  /**
   * 获取更新说明
   */
  getUpdateInstructions(): string {
    return '1. 下载新版本的 DMG 文件\n2. 双击 DMG 文件打开\n3. 将应用拖拽到 Applications 文件夹替换旧版本\n4. 从 Launchpad 重新启动应用'
  }
}

// 导出单例实例
export const dmgUpdater = new DMGUpdater()
