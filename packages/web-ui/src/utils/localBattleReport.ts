import { ElMessage } from 'element-plus'
import { nanoid } from 'nanoid'
import type { BattleRecord } from '@/services/battleReportService'

/**
 * 本地战报数据结构
 */
export interface LocalBattleReport {
  id: string
  name: string
  battleRecord: BattleRecord
  savedAt: string
  description?: string
}

/**
 * 本地战报管理器
 */
export class LocalBattleReportManager {
  private static readonly STORAGE_KEY = 'local_battle_reports'
  private static readonly MAX_REPORTS = 50 // 最大保存数量

  /**
   * 获取所有本地战报
   */
  static getLocalReports(): LocalBattleReport[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (!stored) return []
      
      const reports = JSON.parse(stored) as LocalBattleReport[]
      // 按保存时间倒序排列
      return reports.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    } catch (error) {
      console.error('Failed to load local battle reports:', error)
      return []
    }
  }

  /**
   * 保存战报到本地
   */
  static saveReport(battleRecord: BattleRecord, name?: string, description?: string): boolean {
    try {
      const reports = this.getLocalReports()
      
      // 检查是否已存在相同ID的战报
      const existingIndex = reports.findIndex(r => r.battleRecord.id === battleRecord.id)
      
      const localReport: LocalBattleReport = {
        id: nanoid(),
        name: name || `${battleRecord.player_a_name} vs ${battleRecord.player_b_name}`,
        battleRecord,
        savedAt: new Date().toISOString(),
        description
      }

      if (existingIndex >= 0) {
        // 更新现有战报
        reports[existingIndex] = localReport
        ElMessage.success('战报已更新到本地')
      } else {
        // 添加新战报
        reports.unshift(localReport)
        
        // 限制最大数量
        if (reports.length > this.MAX_REPORTS) {
          reports.splice(this.MAX_REPORTS)
        }
        
        ElMessage.success('战报已保存到本地')
      }

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(reports))
      return true
    } catch (error) {
      console.error('Failed to save battle report:', error)
      ElMessage.error('保存战报失败')
      return false
    }
  }

  /**
   * 删除本地战报
   */
  static deleteReport(reportId: string): boolean {
    try {
      const reports = this.getLocalReports()
      const filteredReports = reports.filter(r => r.id !== reportId)
      
      if (filteredReports.length === reports.length) {
        ElMessage.warning('未找到要删除的战报')
        return false
      }

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredReports))
      ElMessage.success('战报已删除')
      return true
    } catch (error) {
      console.error('Failed to delete battle report:', error)
      ElMessage.error('删除战报失败')
      return false
    }
  }

  /**
   * 获取指定ID的本地战报
   */
  static getReport(reportId: string): LocalBattleReport | null {
    const reports = this.getLocalReports()
    return reports.find(r => r.id === reportId) || null
  }

  /**
   * 导出战报为JSON文件
   */
  static exportReport(reportId: string): void {
    const report = this.getReport(reportId)
    if (!report) {
      ElMessage.error('未找到要导出的战报')
      return
    }

    try {
      const dataStr = JSON.stringify(report, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      
      const link = document.createElement('a')
      link.href = URL.createObjectURL(dataBlob)
      link.download = `battle_report_${report.name}_${new Date().toISOString().split('T')[0]}.json`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      URL.revokeObjectURL(link.href)
      ElMessage.success('战报已导出')
    } catch (error) {
      console.error('Failed to export battle report:', error)
      ElMessage.error('导出战报失败')
    }
  }

  /**
   * 导入战报文件
   */
  static importReport(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string
          const report = JSON.parse(content) as LocalBattleReport
          
          // 验证数据结构
          if (!this.validateReportStructure(report)) {
            ElMessage.error('战报文件格式不正确')
            resolve(false)
            return
          }

          // 生成新的ID避免冲突
          report.id = nanoid()
          report.savedAt = new Date().toISOString()

          const reports = this.getLocalReports()
          reports.unshift(report)
          
          // 限制最大数量
          if (reports.length > this.MAX_REPORTS) {
            reports.splice(this.MAX_REPORTS)
          }

          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(reports))
          ElMessage.success('战报导入成功')
          resolve(true)
        } catch (error) {
          console.error('Failed to import battle report:', error)
          ElMessage.error('导入战报失败：文件格式错误')
          resolve(false)
        }
      }

      reader.onerror = () => {
        ElMessage.error('读取文件失败')
        resolve(false)
      }

      reader.readAsText(file)
    })
  }

  /**
   * 验证战报数据结构
   */
  private static validateReportStructure(report: any): report is LocalBattleReport {
    return (
      report &&
      typeof report.id === 'string' &&
      typeof report.name === 'string' &&
      typeof report.savedAt === 'string' &&
      report.battleRecord &&
      typeof report.battleRecord.id === 'string' &&
      Array.isArray(report.battleRecord.battle_messages) &&
      typeof report.battleRecord.player_a_name === 'string' &&
      typeof report.battleRecord.player_b_name === 'string'
    )
  }

  /**
   * 清空所有本地战报
   */
  static clearAllReports(): boolean {
    try {
      localStorage.removeItem(this.STORAGE_KEY)
      ElMessage.success('已清空所有本地战报')
      return true
    } catch (error) {
      console.error('Failed to clear battle reports:', error)
      ElMessage.error('清空战报失败')
      return false
    }
  }

  /**
   * 获取本地战报统计信息
   */
  static getStatistics() {
    const reports = this.getLocalReports()
    return {
      total: reports.length,
      maxAllowed: this.MAX_REPORTS,
      oldestDate: reports.length > 0 ? reports[reports.length - 1].savedAt : null,
      newestDate: reports.length > 0 ? reports[0].savedAt : null
    }
  }
}
