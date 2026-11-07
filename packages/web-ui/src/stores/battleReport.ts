import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LocalBattleReportManager, type LocalBattleReport } from '@/utils/localBattleReport'

export const useBattleReportStore = defineStore('battleReport', () => {
  const localBattleReports = ref<LocalBattleReport[]>([])
  const currentLocalBattleReport = ref<LocalBattleReport | null>(null)

  const loadLocalBattleReports = () => {
    localBattleReports.value = LocalBattleReportManager.getLocalReports()
  }

  const deleteLocalBattleReport = (reportId: string) => {
    const success = LocalBattleReportManager.deleteReport(reportId)
    if (success) {
      loadLocalBattleReports() // 刷新本地战报列表
    }
    return success
  }

  const loadLocalBattleReport = (reportId: string) => {
    const report = LocalBattleReportManager.getReport(reportId)
    if (report) {
      currentLocalBattleReport.value = report
      console.debug('Local battle report loaded successfully:', reportId)
    } else {
      currentLocalBattleReport.value = null
      console.warn('Local battle report not found:', reportId)
    }
    return report
  }

  const exportLocalBattleReport = (reportId: string) => {
    LocalBattleReportManager.exportReport(reportId)
  }

  const importLocalBattleReport = async (file: File) => {
    const success = await LocalBattleReportManager.importReport(file)
    if (success) {
      loadLocalBattleReports() // 刷新本地战报列表
    }
    return success
  }

  const clearAllLocalBattleReports = () => {
    const success = LocalBattleReportManager.clearAllReports()
    if (success) {
      loadLocalBattleReports() // 刷新本地战报列表
    }
    return success
  }

  const getLocalBattleReportStatistics = () => {
    return LocalBattleReportManager.getStatistics()
  }

  return {
    localBattleReports,
    currentLocalBattleReport,
    loadLocalBattleReports,
    deleteLocalBattleReport,
    loadLocalBattleReport,
    exportLocalBattleReport,
    importLocalBattleReport,
    clearAllLocalBattleReports,
    getLocalBattleReportStatistics,
  }
})
