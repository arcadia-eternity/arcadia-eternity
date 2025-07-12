import type { TimerConfig } from '@arcadia-eternity/const'
import type { Battle } from '@arcadia-eternity/battle'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { RuleSystem } from '../core/RuleSystem'
import { RuleRegistry } from '../core/RuleRegistry'
import type { Team, RuleContext, BattleConfigModifications } from '../interfaces/Rule'
import { RulePhase } from '../interfaces/Rule'
import type { ValidationResult } from '../interfaces/ValidationResult'

/**
 * 战斗系统集成类
 * 提供规则系统与战斗系统的集成功能
 */
export class BattleIntegration {
  private ruleSystem: RuleSystem
  private registry: RuleRegistry

  constructor(ruleSystem?: RuleSystem, registry?: RuleRegistry) {
    this.registry = registry || RuleRegistry.getInstance()
    this.ruleSystem = ruleSystem || new RuleSystem(this.registry)
  }

  /**
   * 在战斗创建前验证和应用规则
   * @param playerATeam 玩家A的队伍
   * @param playerBTeam 玩家B的队伍
   * @param ruleSetIds 要应用的规则集ID列表
   * @param battleOptions 战斗选项
   * @returns 验证结果和修改后的战斗选项
   */
  async prepareBattle(
    playerATeam: Team,
    playerBTeam: Team,
    ruleSetIds: string[],
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
    // 激活规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      this.ruleSystem.activateRuleSet(ruleSetId)
    }

    // 设置规则上下文
    const context: RuleContext = {
      phase: RulePhase.BATTLE_PREPARATION,
      data: { battleOptions },
    }
    this.ruleSystem.setContext(context)

    // 初始化规则系统
    await this.ruleSystem.initialize(context)

    // 验证队伍
    const playerAValidation = this.ruleSystem.validateTeam(playerATeam, context)
    const playerBValidation = this.ruleSystem.validateTeam(playerBTeam, context)

    // 合并验证结果
    const validation: ValidationResult = {
      isValid: playerAValidation.isValid && playerBValidation.isValid,
      errors: [...playerAValidation.errors, ...playerBValidation.errors],
      warnings: [...playerAValidation.warnings, ...playerBValidation.warnings],
    }

    // 如果验证失败，返回结果
    if (!validation.isValid) {
      return {
        validation,
        battleOptions,
        modifiedTeams: {
          playerA: playerATeam,
          playerB: playerBTeam,
        },
      }
    }

    // 应用规则修改
    const modifiedPlayerATeam = this.applyTeamModifications([...playerATeam], context)
    const modifiedPlayerBTeam = this.applyTeamModifications([...playerBTeam], context)

    // 获取战斗配置修改
    const battleConfigMods = this.ruleSystem.getBattleConfigModifications(context)
    const timerConfigMods = this.ruleSystem.getTimerConfigModifications(context)

    // 合并配置
    const finalBattleOptions = {
      ...battleOptions,
      ...battleConfigMods,
      timerConfig: {
        ...battleOptions.timerConfig,
        ...timerConfigMods,
      },
    }

    return {
      validation,
      battleOptions: finalBattleOptions,
      modifiedTeams: {
        playerA: modifiedPlayerATeam,
        playerB: modifiedPlayerBTeam,
      },
    }
  }

  /**
   * 在战斗进行中应用规则
   * @param battle 战斗实例
   * @param context 规则上下文
   */
  async applyBattleRules(battle: Battle, context?: RuleContext): Promise<void> {
    const ctx: RuleContext = context || {
      battle,
      phase: RulePhase.BATTLE_EXECUTION,
    }

    this.ruleSystem.setContext(ctx)

    // 获取额外内容并应用到战斗中
    const additionalContent = this.ruleSystem.getAdditionalContent(ctx)

    // 这里可以将额外的技能、印记等注册到数据仓库
    // 具体实现需要根据数据仓库的API来调整
    if (additionalContent.skills && additionalContent.skills.length > 0) {
      // 注册额外技能
      // DataRepository.getInstance().registerSkills(additionalContent.skills)
    }

    if (additionalContent.marks && additionalContent.marks.length > 0) {
      // 注册额外印记
      // DataRepository.getInstance().registerMarks(additionalContent.marks)
    }
  }

  /**
   * 战斗结束后清理规则
   * @param battle 战斗实例
   */
  async cleanupBattleRules(battle: Battle): Promise<void> {
    const context: RuleContext = {
      battle,
      phase: RulePhase.BATTLE_END,
    }

    this.ruleSystem.setContext(context)
    await this.ruleSystem.cleanup(context)
    this.ruleSystem.clearActiveRuleSets()
  }

  /**
   * 应用队伍修改
   * @param team 队伍数据
   * @param context 规则上下文
   * @returns 修改后的队伍数据
   */
  private applyTeamModifications(team: Team, context: RuleContext): Team {
    for (const pet of team) {
      this.ruleSystem.applyPetModifications(pet, context)
    }
    return team
  }

  /**
   * 验证战斗中的操作
   * @param battle 战斗实例
   * @param operation 操作类型
   * @param data 操作数据
   * @returns 验证结果
   */
  validateBattleOperation(battle: Battle, operation: string, data: any): ValidationResult {
    const context: RuleContext = {
      battle,
      phase: RulePhase.BATTLE_EXECUTION,
      data: { operation, ...data },
    }

    // 这里可以根据具体的操作类型进行验证
    // 例如：技能使用、精灵切换等
    switch (operation) {
      case 'useSkill':
        if (data.pet && data.skill) {
          return this.ruleSystem.validateSkill(data.pet, data.skill, context)
        }
        break
      case 'switchPet':
        if (data.pet) {
          return this.ruleSystem.validatePet(data.pet, context)
        }
        break
      default:
        // 对于未知操作，返回成功
        return { isValid: true, errors: [], warnings: [] }
    }

    return { isValid: true, errors: [], warnings: [] }
  }

  /**
   * 获取当前激活的规则系统
   */
  getRuleSystem(): RuleSystem {
    return this.ruleSystem
  }

  /**
   * 获取规则注册表
   */
  getRegistry(): RuleRegistry {
    return this.registry
  }

  /**
   * 检查规则集是否兼容
   * @param ruleSetIds 规则集ID列表
   * @returns 兼容性检查结果
   */
  checkRuleSetCompatibility(ruleSetIds: string[]): ValidationResult {
    const errors: any[] = []
    const warnings: any[] = []

    // 检查规则集是否存在
    for (const ruleSetId of ruleSetIds) {
      if (!this.registry.hasRuleSet(ruleSetId)) {
        errors.push({
          type: 'SYSTEM_ERROR',
          code: 'RULESET_NOT_FOUND',
          message: `规则集 "${ruleSetId}" 不存在`,
          objectId: ruleSetId,
          objectType: 'ruleSet',
        })
      }
    }

    // 检查规则集是否启用
    for (const ruleSetId of ruleSetIds) {
      const ruleSet = this.registry.getRuleSet(ruleSetId)
      if (ruleSet && !ruleSet.enabled) {
        warnings.push({
          type: 'COMPATIBILITY_WARNING',
          code: 'RULESET_DISABLED',
          message: `规则集 "${ruleSetId}" 已被禁用`,
          objectId: ruleSetId,
          objectType: 'ruleSet',
        })
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }
}
