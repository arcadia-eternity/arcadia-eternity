import type { TimerConfig } from '@arcadia-eternity/const'
import type { Battle } from '@arcadia-eternity/battle'
import { BattleRuleManager } from '../battle/BattleRuleManager'
import { GlobalRuleRegistry } from '../global/GlobalRuleRegistry'
import { initializeGlobalServerSpeciesDataProvider } from '../providers/ServerSpeciesDataProvider'
import { TeamBuilderIntegration } from './TeamBuilderIntegration'
import type { Team } from '../interfaces/Rule'

/**
 * 服务器端规则系统集成
 */
export class ServerRuleIntegration {
  private static initPromise: Promise<void> | null = null
  private static isInitialized: boolean = false
  private static dataRepository: any = null

  /**
   * 确保服务器端规则系统已初始化
   * 如果未初始化，会自动触发初始化
   */
  private static async ensureInitialized(): Promise<void> {
    if (ServerRuleIntegration.isInitialized) {
      return
    }

    if (ServerRuleIntegration.initPromise) {
      return ServerRuleIntegration.initPromise
    }

    ServerRuleIntegration.initPromise = ServerRuleIntegration.performInitialization()
    await ServerRuleIntegration.initPromise
  }

  /**
   * 执行实际的初始化逻辑
   */
  private static async performInitialization(): Promise<void> {
    try {
      await GlobalRuleRegistry.initialize()

      // 如果之前设置了数据仓库，使用它来初始化种族数据提供者
      if (ServerRuleIntegration.dataRepository) {
        initializeGlobalServerSpeciesDataProvider(ServerRuleIntegration.dataRepository)
      }

      ServerRuleIntegration.isInitialized = true
      console.log('服务器端规则系统自动初始化完成')
    } catch (error) {
      console.error('服务器端规则系统初始化失败:', error)
      // 重置状态，允许重试
      ServerRuleIntegration.initPromise = null
      throw error
    }
  }

  /**
   * 初始化服务器端规则系统
   * 应在服务器启动时调用，但不是必须的（会自动初始化）
   * @param dataRepository 可选的数据仓库实例，用于种族数据提供者
   */
  static async initializeServer(dataRepository?: any): Promise<void> {
    // 保存数据仓库以供后续自动初始化使用
    if (dataRepository) {
      ServerRuleIntegration.dataRepository = dataRepository
    }

    // 如果已经初始化过，直接返回
    if (ServerRuleIntegration.isInitialized) {
      return
    }

    // 触发初始化
    await ServerRuleIntegration.ensureInitialized()
  }

  /**
   * 为战斗创建规则管理器
   * @param ruleSetIds 规则集ID列表（可选）
   * @returns 战斗规则管理器实例
   */
  static async createBattleRuleManager(ruleSetIds?: string[]): Promise<BattleRuleManager> {
    await ServerRuleIntegration.ensureInitialized()

    if (!GlobalRuleRegistry.isReady()) {
      throw new Error('全局规则注册表初始化失败')
    }

    return new BattleRuleManager(ruleSetIds, GlobalRuleRegistry.getRegistry())
  }

  /**
   * 初始化种族数据提供者
   * @param dataRepository 数据仓库实例
   */
  static initializeSpeciesDataProvider(dataRepository: any): void {
    initializeGlobalServerSpeciesDataProvider(dataRepository)
    console.log('服务器端种族数据提供者已初始化')
  }

  /**
   * 验证战斗创建请求
   * @param playerATeam 玩家A队伍
   * @param playerBTeam 玩家B队伍
   * @param ruleSetIds 规则集ID列表
   * @param battleOptions 战斗选项
   * @returns 验证结果和修改后的选项
   */
  static async validateBattleCreation(
    playerATeam: Team,
    playerBTeam: Team,
    ruleSetIds?: string[],
    battleOptions: {
      allowFaintSwitch?: boolean
      rngSeed?: number
      showHidden?: boolean
      timerConfig?: Partial<TimerConfig>
    } = {},
  ) {
    const ruleManager = await ServerRuleIntegration.createBattleRuleManager(ruleSetIds)

    // 应用规则到计时器配置
    const recommendedTimerConfig = ruleManager.getRecommendedTimerConfig()
    const finalTimerConfig = {
      ...recommendedTimerConfig,
      ...battleOptions.timerConfig,
    }

    // 验证和准备战斗
    const result = await ruleManager.prepareBattle(playerATeam, playerBTeam, {
      ...battleOptions,
      timerConfig: finalTimerConfig,
    })

    return {
      ...result,
      ruleManager,
    }
  }

  /**
   * 为现有战斗绑定规则管理器
   * @param battle 战斗实例
   * @param ruleManager 规则管理器
   */
  static async bindRulesToBattle(battle: Battle, ruleManager: BattleRuleManager): Promise<void> {
    await ruleManager.bindBattle(battle)
  }

  /**
   * 获取默认战斗选项（应用规则）
   * @param ruleSetIds 规则集ID列表
   * @returns 默认战斗选项
   */
  static async getDefaultBattleOptions(ruleSetIds?: string[]) {
    const ruleManager = await ServerRuleIntegration.createBattleRuleManager(ruleSetIds)
    const timerConfig = ruleManager.getRecommendedTimerConfig()

    return {
      allowFaintSwitch: true,
      showHidden: false,
      timerConfig,
    }
  }

  /**
   * 验证队伍是否符合特定规则集
   * @param team 队伍数据
   * @param ruleSetId 规则集ID
   * @returns 验证结果
   */
  static async validateTeamWithRuleSet(team: Team, ruleSetId: string) {
    try {
      const registry = GlobalRuleRegistry.getRegistry()
      const ruleSet = registry.getRuleSet(ruleSetId)

      if (!ruleSet) {
        return {
          isValid: false,
          errors: [{ message: `规则集 ${ruleSetId} 不存在` }],
          warnings: [],
        }
      }

      // 创建临时的TeamBuilderIntegration实例来验证
      const teamBuilderIntegration = new TeamBuilderIntegration()
      return teamBuilderIntegration.validateTeam(team, [ruleSetId])
    } catch (error) {
      console.error('验证队伍失败:', error)
      return {
        isValid: false,
        errors: [{ message: '验证过程中发生错误' }],
        warnings: [],
      }
    }
  }

  /**
   * 获取服务器规则系统状态
   */
  static getServerStatus() {
    return {
      globalRegistry: GlobalRuleRegistry.getStatus(),
      isReady: GlobalRuleRegistry.isReady(),
    }
  }
}
