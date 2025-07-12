import type { TimerConfig } from '@arcadia-eternity/const'
import type { Battle } from '@arcadia-eternity/battle'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { RuleSystem } from '../core/RuleSystem'
import { RuleRegistry } from '../core/RuleRegistry'
import { BattleIntegration } from '../integration/BattleIntegration'
import { TimerIntegration } from '../integration/TimerIntegration'
import type { Team, RuleContext } from '../interfaces/Rule'
import { RulePhase } from '../interfaces/Rule'
import type { ValidationResult } from '../interfaces/ValidationResult'

/**
 * 战斗规则管理器
 * 为单场战斗提供规则管理功能
 */
export class BattleRuleManager {
  private ruleSystem: RuleSystem
  private battleIntegration: BattleIntegration
  private timerIntegration: TimerIntegration
  private battle: Battle | null = null
  private ruleSetIds: string[]

  constructor(ruleSetIds?: string[], registry?: RuleRegistry) {
    // 使用全局注册表或创建新的注册表实例
    const ruleRegistry = registry || RuleRegistry.getInstance()

    this.ruleSystem = new RuleSystem(ruleRegistry)
    this.battleIntegration = new BattleIntegration(this.ruleSystem, ruleRegistry)
    this.timerIntegration = new TimerIntegration(this.ruleSystem, ruleRegistry)

    // 如果没有指定规则集，使用默认的休闲规则集
    this.ruleSetIds = ruleSetIds || ['casual_standard_ruleset']

    // 激活规则集
    this.activateRuleSets()
  }

  /**
   * 激活规则集
   */
  private activateRuleSets(): void {
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of this.ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        console.warn(`无法激活规则集 ${ruleSetId}:`, error)
      }
    }
  }

  /**
   * 准备战斗（验证队伍并应用规则）
   */
  async prepareBattle(
    playerATeam: Team,
    playerBTeam: Team,
    battleOptions: {
      allowFaintSwitch?: boolean
      rngSeed?: number
      showHidden?: boolean
      timerConfig?: Partial<TimerConfig>
    } = {},
  ): Promise<{
    validation: ValidationResult
    battleOptions: typeof battleOptions
    modifiedTeams: {
      playerA: Team
      playerB: Team
    }
  }> {
    return this.battleIntegration.prepareBattle(playerATeam, playerBTeam, this.ruleSetIds, battleOptions)
  }

  /**
   * 绑定战斗实例并应用规则
   */
  async bindBattle(battle: Battle): Promise<void> {
    this.battle = battle

    const context: RuleContext = {
      battle,
      phase: RulePhase.BATTLE_EXECUTION,
    }

    await this.battleIntegration.applyBattleRules(battle, context)
  }

  /**
   * 验证战斗操作
   */
  validateBattleOperation(operation: string, data: any): ValidationResult {
    if (!this.battle) {
      return { isValid: true, errors: [], warnings: [] }
    }

    return this.battleIntegration.validateBattleOperation(this.battle, operation, data)
  }

  /**
   * 获取推荐的计时器配置
   */
  getRecommendedTimerConfig(): TimerConfig {
    return this.timerIntegration.getRecommendedTimerConfig(this.ruleSetIds)
  }

  /**
   * 验证计时器配置
   */
  validateTimerConfig(config: TimerConfig) {
    return this.timerIntegration.validateTimerConfig(config, this.ruleSetIds)
  }

  /**
   * 应用计时器规则修改
   */
  applyTimerRules(baseConfig: TimerConfig): TimerConfig {
    return this.timerIntegration.applyRulesToTimerConfig(baseConfig, this.ruleSetIds)
  }

  /**
   * 战斗结束清理
   */
  async cleanup(): Promise<void> {
    if (this.battle) {
      await this.battleIntegration.cleanupBattleRules(this.battle)
      this.battle = null
    }
  }

  /**
   * 获取当前规则集ID列表
   */
  getRuleSetIds(): string[] {
    return [...this.ruleSetIds]
  }

  /**
   * 获取激活的规则列表
   */
  getActiveRules() {
    return this.ruleSystem.getActiveRules()
  }

  /**
   * 获取规则系统状态
   */
  getStatus() {
    return {
      ruleSetIds: this.ruleSetIds,
      activeRules: this.getActiveRules().map(rule => ({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        priority: rule.priority,
      })),
      hasBattle: !!this.battle,
    }
  }
}
