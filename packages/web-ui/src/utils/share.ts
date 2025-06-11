import { ElMessage } from 'element-plus'

/**
 * 分享工具类
 */
export class ShareUtils {
  /**
   * 复制文本到剪贴板
   */
  static async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        // 使用现代 Clipboard API
        await navigator.clipboard.writeText(text)
        return true
      } else {
        // 降级方案：使用传统方法
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        
        const successful = document.execCommand('copy')
        document.body.removeChild(textArea)
        return successful
      }
    } catch (error) {
      console.error('复制到剪贴板失败:', error)
      return false
    }
  }

  /**
   * 生成战报分享链接
   */
  static generateBattleReportShareUrl(battleId: string): string {
    const baseUrl = window.location.origin
    return `${baseUrl}/battle-reports/${battleId}`
  }

  /**
   * 生成战报预览分享链接
   */
  static generateBattleReportPreviewUrl(battleId: string): string {
    const baseUrl = window.location.origin
    return `${baseUrl}/battle-reports/${battleId}/preview`
  }

  /**
   * 分享战报详情
   */
  static async shareBattleReport(battleId: string, playerAName?: string, playerBName?: string): Promise<void> {
    const url = this.generateBattleReportShareUrl(battleId)
    const title = playerAName && playerBName 
      ? `${playerAName} vs ${playerBName} 的战报` 
      : '战报详情'
    
    const shareText = `${title}\n${url}`
    
    const success = await this.copyToClipboard(shareText)
    if (success) {
      ElMessage.success('战报链接已复制到剪贴板')
    } else {
      ElMessage.error('复制失败，请手动复制链接')
    }
  }

  /**
   * 分享战报预览
   */
  static async shareBattleReportPreview(battleId: string, playerAName?: string, playerBName?: string): Promise<void> {
    const url = this.generateBattleReportPreviewUrl(battleId)
    const title = playerAName && playerBName 
      ? `观看 ${playerAName} vs ${playerBName} 的战报回放` 
      : '战报回放'
    
    const shareText = `${title}\n${url}`
    
    const success = await this.copyToClipboard(shareText)
    if (success) {
      ElMessage.success('战报回放链接已复制到剪贴板')
    } else {
      ElMessage.error('复制失败，请手动复制链接')
    }
  }

  /**
   * 检查是否支持 Web Share API
   */
  static isWebShareSupported(): boolean {
    return 'share' in navigator
  }

  /**
   * 使用 Web Share API 分享（如果支持）
   */
  static async shareWithWebAPI(title: string, text: string, url: string): Promise<boolean> {
    if (!this.isWebShareSupported()) {
      return false
    }

    try {
      await navigator.share({
        title,
        text,
        url
      })
      return true
    } catch (error) {
      // 用户取消分享或其他错误
      console.log('Web Share API 分享取消或失败:', error)
      return false
    }
  }

  /**
   * 智能分享：优先使用 Web Share API，降级到复制链接
   */
  static async smartShare(title: string, text: string, url: string): Promise<void> {
    // 先尝试使用 Web Share API
    const webShareSuccess = await this.shareWithWebAPI(title, text, url)
    
    if (!webShareSuccess) {
      // 降级到复制链接
      const shareText = `${title}\n${text}\n${url}`
      const success = await this.copyToClipboard(shareText)
      
      if (success) {
        ElMessage.success('链接已复制到剪贴板')
      } else {
        ElMessage.error('分享失败，请手动复制链接')
      }
    }
  }
}
