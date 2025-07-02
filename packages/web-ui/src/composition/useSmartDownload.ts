import { ref, computed, onMounted } from 'vue'
import { DownloadManager } from '@/utils/downloadManager'
import { 
  downloadSourceTemplates, 
  generateAssetConfig, 
  DownloadSourceConfig,
  getRecommendedSourcesForRegion 
} from '@/config/downloadSources'
import { 
  getPlatformInfo, 
  detectRegion, 
  getEnvironmentInfo 
} from '@/utils/platformDetection'
import type { 
  DownloadSource, 
  DownloadResult, 
  DownloadOptions, 
  PlatformInfo 
} from '@/types/download'

/**
 * 智能下载组合式函数
 * 提供完整的下载管理功能，包括源检测、平台识别和智能降级
 */
export function useSmartDownload() {
  // 响应式状态
  const isInitialized = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const downloadManager = ref<DownloadManager | null>(null)
  const platformInfo = ref<PlatformInfo | null>(null)
  const sourceAvailability = ref<Record<string, boolean>>({})
  const lastDownloadResult = ref<DownloadResult | null>(null)

  // 配置管理器
  const sourceConfig = DownloadSourceConfig.getInstance()

  // 计算属性
  const version = computed(() => import.meta.env.VITE_APP_VERSION || '1.0.0')
  const availableSources = computed(() => downloadManager.value?.getSources() || [])
  const recommendedPlatform = computed(() => platformInfo.value?.platform)
  const recommendedArchitecture = computed(() => platformInfo.value?.architecture)
  const recommendedFormat = computed(() => platformInfo.value?.recommendedFormat)
  const isMobile = computed(() => platformInfo.value?.isMobile || false)

  /**
   * 初始化下载管理器
   */
  const initialize = async () => {
    if (isInitialized.value) return

    try {
      isLoading.value = true
      error.value = null

      // 检测平台信息
      platformInfo.value = getPlatformInfo()

      // 生成资源配置
      const assets = generateAssetConfig(version.value)

      // 创建下载管理器
      downloadManager.value = new DownloadManager(version.value, assets)

      // 根据地区获取推荐的源
      const region = detectRegion()
      const recommendedSources = getRecommendedSourcesForRegion(region)

      // 添加激活的下载源
      const activeSources = sourceConfig.getActiveSources()
      const sourcesToAdd = activeSources.length > 0 ? activeSources : recommendedSources

      for (const sourceId of sourcesToAdd) {
        const template = sourceConfig.getSourceTemplate(sourceId)
        if (template) {
          const source: DownloadSource = {
            ...template,
            baseUrl: template.baseUrl(version.value),
            enabled: true
          }
          downloadManager.value.addSource(source)
        }
      }

      // 检测源可用性
      await checkSourcesAvailability()

      isInitialized.value = true
    } catch (err) {
      error.value = `Failed to initialize download manager: ${err}`
      console.error('Download manager initialization error:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 检测所有源的可用性
   */
  const checkSourcesAvailability = async () => {
    if (!downloadManager.value) return

    try {
      const availability = await downloadManager.value.checkAllSourcesAvailability()
      sourceAvailability.value = availability
    } catch (err) {
      console.warn('Failed to check source availability:', err)
    }
  }

  /**
   * 获取最佳下载源
   */
  const getBestSource = async () => {
    if (!downloadManager.value) return null

    const region = detectRegion()
    return await downloadManager.value.getBestSource(region)
  }

  /**
   * 智能下载
   */
  const smartDownload = async (options: Partial<DownloadOptions> = {}) => {
    if (!downloadManager.value || !platformInfo.value) {
      await initialize()
    }

    if (!downloadManager.value || !platformInfo.value) {
      const result: DownloadResult = {
        success: false,
        error: 'Download manager not initialized'
      }
      lastDownloadResult.value = result
      return result
    }

    try {
      isLoading.value = true
      error.value = null

      const downloadOptions: DownloadOptions = {
        platform: recommendedPlatform.value,
        architecture: recommendedArchitecture.value,
        format: recommendedFormat.value,
        enableFallback: true,
        ...options
      }

      const result = await downloadManager.value.smartDownload(downloadOptions)
      lastDownloadResult.value = result

      if (!result.success) {
        error.value = result.error || 'Download failed'
      }

      return result
    } catch (err) {
      const errorMessage = `Download error: ${err}`
      error.value = errorMessage
      const result: DownloadResult = {
        success: false,
        error: errorMessage
      }
      lastDownloadResult.value = result
      return result
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 下载特定平台和格式
   */
  const downloadSpecific = async (
    platform: string, 
    architecture: string, 
    format?: string
  ) => {
    return await smartDownload({
      platform: platform as any,
      architecture: architecture as any,
      format: format as any
    })
  }

  /**
   * 获取下载链接（不执行下载）
   */
  const getDownloadUrls = (
    platform?: string, 
    architecture?: string, 
    format?: string
  ) => {
    if (!downloadManager.value || !platformInfo.value) return []

    const targetPlatform = platform || recommendedPlatform.value
    const targetArchitecture = architecture || recommendedArchitecture.value
    const targetFormat = format || recommendedFormat.value

    return downloadManager.value.getDownloadUrls(
      targetPlatform as any,
      targetArchitecture as any,
      targetFormat as any
    )
  }

  /**
   * 添加自定义下载源
   */
  const addCustomSource = (source: DownloadSource) => {
    if (!downloadManager.value) return false

    try {
      downloadManager.value.addSource(source)
      return true
    } catch (err) {
      console.error('Failed to add custom source:', err)
      return false
    }
  }

  /**
   * 移除下载源
   */
  const removeSource = (sourceId: string) => {
    if (!downloadManager.value) return false

    return downloadManager.value.removeSource(sourceId)
  }

  /**
   * 切换源的启用状态
   */
  const toggleSource = (sourceId: string, enabled: boolean) => {
    if (!downloadManager.value) return false

    return downloadManager.value.toggleSource(sourceId, enabled)
  }

  /**
   * 刷新源可用性
   */
  const refreshSourceAvailability = async () => {
    await checkSourcesAvailability()
  }

  /**
   * 获取环境信息
   */
  const getEnvironment = () => {
    return getEnvironmentInfo()
  }

  /**
   * 重置下载管理器
   */
  const reset = () => {
    isInitialized.value = false
    downloadManager.value = null
    platformInfo.value = null
    sourceAvailability.value = {}
    lastDownloadResult.value = null
    error.value = null
  }

  /**
   * 更新版本
   */
  const updateVersion = (newVersion: string) => {
    if (downloadManager.value) {
      downloadManager.value.updateVersion(newVersion)
    }
  }

  // 自动初始化
  onMounted(() => {
    initialize()
  })

  return {
    // 状态
    isInitialized,
    isLoading,
    error,
    platformInfo,
    sourceAvailability,
    lastDownloadResult,

    // 计算属性
    version,
    availableSources,
    recommendedPlatform,
    recommendedArchitecture,
    recommendedFormat,
    isMobile,

    // 方法
    initialize,
    smartDownload,
    downloadSpecific,
    getDownloadUrls,
    getBestSource,
    addCustomSource,
    removeSource,
    toggleSource,
    checkSourcesAvailability,
    refreshSourceAvailability,
    getEnvironment,
    reset,
    updateVersion
  }
}
