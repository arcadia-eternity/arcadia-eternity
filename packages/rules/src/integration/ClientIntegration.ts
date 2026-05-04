import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import { TeamBuilderRuleManager } from '../teambuilder/TeamBuilderRuleManager'
import { GlobalRuleRegistry } from '../global/GlobalRuleRegistry'
import { TeamBuilderIntegration } from './TeamBuilderIntegration'
import type { Team } from '../interfaces/Rule'
import { initializeGlobalClientSpeciesDataProvider } from '../providers/ClientSpeciesDataProvider'
import { getGlobalClientSpeciesDataProvider } from '../providers/ClientSpeciesDataProvider'

/**
 * 客户端规则系统集成
 */
export class ClientRuleIntegration {
  private static teamBuilderManager: TeamBuilderRuleManager | null = null
  private static initPromise: Promise<void> | null = null
  private static isInitialized: boolean = false
  private static gameDataStore: any = null

  /**
   * 确保客户端规则系统已初始化
   * 如果未初始化，会自动触发初始化
   */
  private static async ensureInitialized(): Promise<void> {
    if (ClientRuleIntegration.isInitialized) {
      return
    }

    if (ClientRuleIntegration.initPromise) {
      return ClientRuleIntegration.initPromise
    }

    ClientRuleIntegration.initPromise = ClientRuleIntegration.performInitialization()
    await ClientRuleIntegration.initPromise
  }

  /**
   * 执行实际的初始化逻辑
   */
  private static async performInitialization(): Promise<void> {
    try {
      await GlobalRuleRegistry.initialize()

      // 如果之前设置了游戏数据存储，使用它来初始化种族数据提供者
      if (ClientRuleIntegration.gameDataStore) {
        initializeGlobalClientSpeciesDataProvider(ClientRuleIntegration.gameDataStore)
        // 更新所有需要种族数据的规则的种族数据提供者
        await ClientRuleIntegration.updateSkillAvailabilityRulesDataProvider()
      }

      ClientRuleIntegration.teamBuilderManager = new TeamBuilderRuleManager(
        ['casual_standard_ruleset'],
        GlobalRuleRegistry.getRegistry(),
      )

      ClientRuleIntegration.isInitialized = true
      console.log('客户端规则系统自动初始化完成')
    } catch (error) {
      console.error('客户端规则系统初始化失败:', error)
      // 重置状态，允许重试
      ClientRuleIntegration.initPromise = null
      throw error
    }
  }

  /**
   * 初始化客户端规则系统
   * 应在应用启动时调用，但不是必须的（会自动初始化）
   * @param gameDataStore 可选的游戏数据存储实例，用于种族数据提供者
   */
  static async initializeClient(gameDataStore?: any): Promise<void> {
    // 保存游戏数据存储以供后续自动初始化使用
    if (gameDataStore) {
      ClientRuleIntegration.gameDataStore = gameDataStore
    }

    // 如果已经初始化过，直接返回
    if (ClientRuleIntegration.isInitialized) {
      return
    }

    // 触发初始化
    await ClientRuleIntegration.ensureInitialized()
  }

  /**
   * 获取队伍构建器规则管理器
   */
  static async getTeamBuilderManager(): Promise<TeamBuilderRuleManager> {
    await ClientRuleIntegration.ensureInitialized()
    if (!ClientRuleIntegration.teamBuilderManager) {
      throw new Error('客户端规则系统初始化失败')
    }
    return ClientRuleIntegration.teamBuilderManager
  }

  /**
   * 获取队伍构建器规则管理器（同步版本，仅在确定已初始化时使用）
   */
  static getTeamBuilderManagerSync(): TeamBuilderRuleManager {
    if (!ClientRuleIntegration.teamBuilderManager) {
      throw new Error('客户端规则系统尚未初始化，请使用异步版本 getTeamBuilderManager()')
    }
    return ClientRuleIntegration.teamBuilderManager
  }

  /**
   * 设置队伍构建器的规则集
   * @param ruleSetIds 规则集ID列表
   */
  static async setTeamBuilderRuleSetIds(ruleSetIds: string[]): Promise<void> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    manager.setRuleSetIds(ruleSetIds)
  }

  /**
   * 验证队伍（用于队伍构建器）
   * @param team 队伍数据
   * @returns 验证结果
   */
  static async validateTeam(team: Team) {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.validateTeam(team)
  }

  /**
   * 验证精灵（用于队伍构建器）
   * @param pet 精灵数据
   * @param team 当前队伍
   * @returns 验证结果
   */
  static async validatePet(pet: PetSchemaType, team: Team) {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.validatePet(pet, team)
  }

  /**
   * 获取队伍构建建议
   * @param team 当前队伍
   * @returns 构建建议
   */
  static async getTeamBuildingSuggestions(team: Team) {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getTeamBuildingSuggestions(team)
  }

  /**
   * 自动修复队伍
   * @param team 队伍数据
   * @returns 修复结果
   */
  static async autoFixTeam(team: Team) {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.autoFixTeam(team)
  }

  /**
   * 获取当前规则限制信息
   * @returns 规则限制信息
   */
  static async getRuleLimitations() {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getRuleLimitations()
  }

  /**
   * 检查是否可以添加更多精灵
   * @param team 当前队伍
   * @returns 是否可以添加
   */
  static async canAddMorePets(team: Team): Promise<boolean> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.canAddMorePets(team)
  }

  /**
   * 检查精灵种族是否被禁用
   * @param speciesId 精灵种族ID
   * @returns 是否被禁用
   */
  static async isSpeciesBanned(speciesId: string): Promise<boolean> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.isSpeciesBanned(speciesId)
  }

  /**
   * 检查技能是否被禁用
   * @param skillId 技能ID
   * @returns 是否被禁用
   */
  static async isSkillBanned(skillId: string): Promise<boolean> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.isSkillBanned(skillId)
  }

  /**
   * 检查印记是否被禁用
   * @param markId 印记ID
   * @returns 是否被禁用
   */
  static async isMarkBanned(markId: string): Promise<boolean> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.isMarkBanned(markId)
  }

  /**
   * 获取可用的规则集列表
   * @returns 规则集ID列表
   */
  static async getAvailableRuleSets(): Promise<string[]> {
    return ['casual_standard_ruleset', 'competitive_ruleset']
  }

  /**
   * 获取推荐的队伍大小
   * @returns 队伍大小限制
   */
  static async getRecommendedTeamSize() {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getRecommendedTeamSize()
  }

  /**
   * 获取等级限制
   * @returns 等级限制
   */
  static async getLevelLimits() {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getLevelLimits()
  }

  /**
   * 获取学习力限制
   * @returns 学习力限制
   */
  static async getEVLimits() {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getEVLimits()
  }

  /**
   * 获取当前规则集ID列表
   * @returns 当前规则集ID列表
   */
  static async getCurrentRuleSetIds(): Promise<string[]> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getCurrentRuleSetIds()
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

      // 使用全局注册表创建TeamBuilderIntegration实例来验证
      const teamBuilderIntegration = new TeamBuilderIntegration(undefined, registry)
      const ruleSystem = teamBuilderIntegration.getRuleSystem()

      // 然后激活规则集
      ruleSystem.clearActiveRuleSets()
      ruleSystem.activateRuleSet(ruleSetId)

      // 设置规则上下文
      const context = {
        phase: 'TEAM_BUILDING' as any,
        data: {
          team,
          ruleSystem: ruleSystem,
        },
      }
      ruleSystem.setContext(context)

      // 验证队伍
      return ruleSystem.validateTeam(team, context)
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
   * 获取特定种族的额外可学习技能（仅在队伍构建验证过程中生效）
   * @param speciesId 种族ID
   * @returns 额外可学习技能列表
   */
  static async getSpeciesExtraLearnableSkills(speciesId: string): Promise<LearnableSkill[]> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getSpeciesExtraLearnableSkills(speciesId)
  }

  /**
   * 获取精灵种族允许的性别列表
   * @param speciesId 种族ID
   * @returns 允许的性别列表
   */
  static async getAllowedGendersForSpecies(speciesId: string): Promise<string[]> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.getAllowedGendersForSpecies(speciesId)
  }

  /**
   * 检查指定性别是否被种族允许
   * @param speciesId 种族ID
   * @param gender 性别
   * @returns 是否允许
   */
  static async isGenderAllowedForSpecies(speciesId: string, gender: string): Promise<boolean> {
    const manager = await ClientRuleIntegration.getTeamBuilderManager()
    return manager.isGenderAllowedForSpecies(speciesId, gender)
  }

  /**
   * 获取客户端规则系统状态
   */
  static getClientStatus() {
    return {
      globalRegistry: GlobalRuleRegistry.getStatus(),
      teamBuilder: ClientRuleIntegration.teamBuilderManager?.getStatus(),
      isReady: !!ClientRuleIntegration.teamBuilderManager,
    }
  }

  /**
   * 初始化种族数据提供者
   * @param gameDataStore 游戏数据存储实例
   */
  static async initializeSpeciesDataProvider(gameDataStore: any): Promise<void> {
    initializeGlobalClientSpeciesDataProvider(gameDataStore)

    // 重新设置所有需要种族数据的规则的种族数据提供者
    await ClientRuleIntegration.updateSkillAvailabilityRulesDataProvider()
  }

  /**
   * 更新所有需要种族数据的规则的种族数据提供者
   */
  private static async updateSkillAvailabilityRulesDataProvider(): Promise<void> {
    try {
      const provider = getGlobalClientSpeciesDataProvider()

      if (!provider) {
        console.warn('无法获取全局种族数据提供者')
        return
      }

      const registry = GlobalRuleRegistry.getRegistry()
      const allRules = registry.getAllRules()

      // 查找所有需要种族数据的规则并更新其数据提供者
      let updatedCount = 0
      for (const rule of allRules) {
        // 更新技能验证规则
        if (rule.id.includes('skill_availability') && typeof (rule as any).setSpeciesDataProvider === 'function') {
          ;(rule as any).setSpeciesDataProvider(provider)
          updatedCount++
        }
        // 更新性别限制规则
        else if (rule.id.includes('gender_restriction') && typeof (rule as any).setSpeciesDataProvider === 'function') {
          ;(rule as any).setSpeciesDataProvider(provider)
          updatedCount++
        }
      }

      if (updatedCount > 0) {
        console.log(`✅ 已更新 ${updatedCount} 个规则的种族数据提供者`)
      }
    } catch (error) {
      console.error('更新规则数据提供者失败:', error)
    }
  }

  /**
   * 重置客户端规则系统（主要用于测试）
   */
  static reset(): void {
    ClientRuleIntegration.teamBuilderManager = null
  }
}
