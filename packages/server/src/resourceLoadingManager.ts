import { loadGameData, LOADING_STRATEGIES, type LoadingStrategy } from '@arcadia-eternity/fsloader'
import { ScriptLoader } from '@arcadia-eternity/data-repository'
import { validateAndPrintGameData } from '@arcadia-eternity/cli-validator'
import pino from 'pino'

const logger = pino({ name: 'ResourceLoadingManager' })

export enum ResourceLoadingStatus {
  NotStarted = 'not_started',
  Loading = 'loading',
  Completed = 'completed',
  Failed = 'failed',
}

export interface ResourceLoadingProgress {
  status: ResourceLoadingStatus
  startTime?: Date
  completedTime?: Date
  error?: string
  gameDataLoaded: boolean
  scriptsLoaded: boolean
  validationCompleted: boolean
}

export interface ResourceLoadingOptions {
  dataDir?: string
  scriptPaths?: string[]
  loadingStrategy?: LoadingStrategy
  validateData?: boolean
  continueOnError?: boolean
}

/**
 * 异步资源加载管理器
 * 负责在后台异步加载游戏资源，并提供等待机制确保战斗开始前资源已加载完成
 */
export class ResourceLoadingManager {
  private static instance: ResourceLoadingManager
  private progress: ResourceLoadingProgress = {
    status: ResourceLoadingStatus.NotStarted,
    gameDataLoaded: false,
    scriptsLoaded: false,
    validationCompleted: false,
  }
  private loadingPromise: Promise<void> | null = null
  private options: ResourceLoadingOptions = {}

  static getInstance(): ResourceLoadingManager {
    if (!ResourceLoadingManager.instance) {
      ResourceLoadingManager.instance = new ResourceLoadingManager()
    }
    return ResourceLoadingManager.instance
  }

  /**
   * 启动异步资源加载
   */
  async startAsyncLoading(options: ResourceLoadingOptions = {}): Promise<void> {
    if (this.progress.status === ResourceLoadingStatus.Loading) {
      logger.warn('资源加载已在进行中，忽略重复启动请求')
      return this.loadingPromise!
    }

    if (this.progress.status === ResourceLoadingStatus.Completed) {
      logger.info('资源已加载完成，无需重新加载')
      return Promise.resolve()
    }

    this.options = {
      loadingStrategy: LOADING_STRATEGIES.LENIENT,
      scriptPaths: ['./scripts'],
      validateData: false,
      continueOnError: true,
      ...options,
    }

    this.progress = {
      status: ResourceLoadingStatus.Loading,
      startTime: new Date(),
      gameDataLoaded: false,
      scriptsLoaded: false,
      validationCompleted: false,
    }

    logger.info('开始异步加载游戏资源...')

    this.loadingPromise = this.performLoading()
    return this.loadingPromise
  }

  /**
   * 等待资源加载完成
   * 如果资源尚未开始加载，会自动启动加载
   */
  async waitForResourcesReady(options?: ResourceLoadingOptions): Promise<void> {
    if (this.progress.status === ResourceLoadingStatus.Completed) {
      return Promise.resolve()
    }

    if (this.progress.status === ResourceLoadingStatus.NotStarted) {
      logger.info('资源尚未开始加载，自动启动加载流程')
      await this.startAsyncLoading(options)
      return
    }

    if (this.progress.status === ResourceLoadingStatus.Loading && this.loadingPromise) {
      logger.info('等待资源加载完成...')
      await this.loadingPromise
      return
    }

    if (this.progress.status === ResourceLoadingStatus.Failed) {
      throw new Error(`资源加载失败: ${this.progress.error}`)
    }
  }

  /**
   * 获取资源加载进度
   */
  getProgress(): ResourceLoadingProgress {
    return { ...this.progress }
  }

  /**
   * 检查资源是否已准备就绪
   */
  isReady(): boolean {
    return this.progress.status === ResourceLoadingStatus.Completed
  }

  /**
   * 重置加载状态（用于测试或重新加载）
   */
  reset(): void {
    this.progress = {
      status: ResourceLoadingStatus.NotStarted,
      gameDataLoaded: false,
      scriptsLoaded: false,
      validationCompleted: false,
    }
    this.loadingPromise = null
    logger.info('资源加载状态已重置')
  }

  /**
   * 执行实际的资源加载
   */
  private async performLoading(): Promise<void> {
    try {
      logger.info('开始加载游戏数据...')
      await loadGameData(this.options.dataDir, this.options.loadingStrategy)
      this.progress.gameDataLoaded = true
      logger.info('游戏数据加载完成')

      logger.info('开始加载脚本声明...')
      await this.loadScripts()
      this.progress.scriptsLoaded = true
      logger.info('脚本声明加载完成')

      if (this.options.validateData) {
        logger.info('开始验证数据完整性...')
        const isValid = await validateAndPrintGameData({ verbose: false })
        if (!isValid && !this.options.continueOnError) {
          throw new Error('数据验证失败')
        }
        this.progress.validationCompleted = true
        logger.info('数据验证完成')
      } else {
        this.progress.validationCompleted = true
      }

      this.progress.status = ResourceLoadingStatus.Completed
      this.progress.completedTime = new Date()
      
      const duration = this.progress.completedTime.getTime() - this.progress.startTime!.getTime()
      logger.info(`资源加载完成，耗时: ${duration}ms`)

    } catch (error) {
      this.progress.status = ResourceLoadingStatus.Failed
      this.progress.error = error instanceof Error ? error.message : String(error)
      logger.error({ error: this.progress.error }, '资源加载失败')
      
      if (!this.options.continueOnError) {
        throw error
      }
    }
  }

  /**
   * 加载脚本声明
   */
  private async loadScripts(): Promise<void> {
    try {
      const loader = new ScriptLoader({ 
        scriptPaths: this.options.scriptPaths || ['./scripts'], 
        recursive: true 
      })

      for (const scriptPath of this.options.scriptPaths || ['./scripts']) {
        await loader.loadScriptsFromFileSystem(scriptPath)
      }

      const stats = loader.getLoadedScriptsStats()
      logger.info({ stats }, '脚本加载统计')
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : error }, '脚本加载失败，继续使用YAML数据')
      // 脚本加载失败不应该阻止整个流程
    }
  }
}

// 导出单例实例
export const resourceLoadingManager = ResourceLoadingManager.getInstance()
