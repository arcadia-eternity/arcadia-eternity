import type { PetSchemaType } from '@arcadia-eternity/schema'
import { RuleSystem } from '../core/RuleSystem'
import { RuleRegistry } from '../core/RuleRegistry'
import type { Team, RuleContext } from '../interfaces/Rule'
import { RulePhase } from '../interfaces/Rule'
import type { ValidationResult } from '../interfaces/ValidationResult'

/**
 * 队伍构建器集成类
 * 提供规则系统与队伍构建器的集成功能
 */
export class TeamBuilderIntegration {
  private ruleSystem: RuleSystem
  private registry: RuleRegistry

  constructor(ruleSystem?: RuleSystem, registry?: RuleRegistry) {
    this.registry = registry || RuleRegistry.getInstance()
    this.ruleSystem = ruleSystem || new RuleSystem(this.registry)
  }

  /**
   * 验证队伍是否符合规则要求
   * @param team 队伍数据
   * @param ruleSetIds 要应用的规则集ID列表
   * @returns 验证结果
   */
  validateTeam(team: Team, ruleSetIds: string[]): ValidationResult {
    // 激活规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        console.warn(`Failed to activate rule set ${ruleSetId}:`, error)
      }
    }

    // 设置规则上下文，包含规则系统引用以便技能验证规则使用
    const context: RuleContext = {
      phase: RulePhase.TEAM_BUILDING,
      data: {
        team,
        ruleSystem: this.ruleSystem, // 添加规则系统引用
      },
    }
    this.ruleSystem.setContext(context)

    // 验证队伍
    return this.ruleSystem.validateTeam(team, context)
  }

  /**
   * 验证单个精灵是否符合规则要求
   * @param pet 精灵数据
   * @param team 当前队伍（用于上下文）
   * @param ruleSetIds 要应用的规则集ID列表
   * @returns 验证结果
   */
  validatePet(pet: PetSchemaType, team: Team, ruleSetIds: string[]): ValidationResult {
    // 激活规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        console.warn(`Failed to activate rule set ${ruleSetId}:`, error)
      }
    }

    // 设置规则上下文
    const context: RuleContext = {
      phase: RulePhase.TEAM_BUILDING,
      data: { pet, team },
    }
    this.ruleSystem.setContext(context)

    // 验证精灵
    return this.ruleSystem.validatePet(pet, context)
  }

  /**
   * 获取队伍构建建议
   * @param currentTeam 当前队伍
   * @param ruleSetIds 要应用的规则集ID列表
   * @returns 构建建议
   */
  getTeamBuildingSuggestions(
    currentTeam: Team,
    ruleSetIds: string[],
  ): {
    suggestions: Array<{
      type: 'add' | 'remove' | 'modify' | 'warning'
      message: string
      petId?: string
      details?: any
    }>
    canAddMore: boolean
    maxTeamSize: number
    minTeamSize: number
  } {
    const suggestions: Array<{
      type: 'add' | 'remove' | 'modify' | 'warning'
      message: string
      petId?: string
      details?: any
    }> = []

    // 激活规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        suggestions.push({
          type: 'warning',
          message: `无法激活规则集 "${ruleSetId}"`,
        })
        continue
      }
    }

    // 设置规则上下文
    const context: RuleContext = {
      phase: RulePhase.TEAM_BUILDING,
      data: { team: currentTeam },
    }
    this.ruleSystem.setContext(context)

    // 验证当前队伍
    const validation = this.ruleSystem.validateTeam(currentTeam, context)

    // 分析验证结果并生成建议
    let maxTeamSize = 6 // 默认最大队伍大小
    let minTeamSize = 1 // 默认最小队伍大小

    for (const error of validation.errors) {
      switch (error.code) {
        case 'TEAM_TOO_SMALL':
          suggestions.push({
            type: 'add',
            message: `队伍精灵数量不足，还需要添加 ${error.context?.minSize - currentTeam.length} 只精灵`,
            details: error.context,
          })
          minTeamSize = error.context?.minSize || minTeamSize
          break

        case 'TEAM_TOO_LARGE':
          suggestions.push({
            type: 'remove',
            message: `队伍精灵数量过多，需要移除 ${currentTeam.length - error.context?.maxSize} 只精灵`,
            details: error.context,
          })
          maxTeamSize = error.context?.maxSize || maxTeamSize
          break

        case 'LEVEL_TOO_LOW':
        case 'LEVEL_TOO_HIGH':
          suggestions.push({
            type: 'modify',
            message: error.message,
            petId: error.objectId,
            details: error.context,
          })
          break

        case 'EV_TOTAL_EXCEEDED':
        case 'EV_SINGLE_EXCEEDED':
          suggestions.push({
            type: 'modify',
            message: `精灵 "${error.context?.petName}" 的学习力需要调整`,
            petId: error.objectId,
            details: error.context,
          })
          break

        case 'BANNED_SPECIES':
        case 'BANNED_SKILL':
        case 'BANNED_ABILITY':
        case 'BANNED_EMBLEM':
          suggestions.push({
            type: 'remove',
            message: error.message,
            petId: error.objectId,
            details: error.context,
          })
          break

        default:
          suggestions.push({
            type: 'warning',
            message: error.message,
            petId: error.objectId,
            details: error.context,
          })
      }
    }

    // 添加警告信息
    for (const warning of validation.warnings) {
      suggestions.push({
        type: 'warning',
        message: warning.message,
        petId: warning.objectId,
        details: warning.context,
      })
    }

    return {
      suggestions,
      canAddMore: currentTeam.length < maxTeamSize,
      maxTeamSize,
      minTeamSize,
    }
  }

  /**
   * 自动修复队伍以符合规则要求
   * @param team 队伍数据
   * @param ruleSetIds 要应用的规则集ID列表
   * @returns 修复后的队伍和修复报告
   */
  autoFixTeam(
    team: Team,
    ruleSetIds: string[],
  ): {
    fixedTeam: Team
    changes: Array<{
      type: 'modified' | 'removed'
      petId: string
      petName: string
      description: string
      details?: any
    }>
    remainingIssues: ValidationResult
  } {
    const changes: Array<{
      type: 'modified' | 'removed'
      petId: string
      petName: string
      description: string
      details?: any
    }> = []

    // 激活规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        console.warn(`Failed to activate rule set ${ruleSetId}:`, error)
      }
    }

    // 设置规则上下文
    const context: RuleContext = {
      phase: RulePhase.TEAM_BUILDING,
      data: { team },
    }
    this.ruleSystem.setContext(context)

    // 复制队伍数据
    let fixedTeam: Team = team.map(pet => ({ ...pet }))

    // 应用规则修改
    for (const pet of fixedTeam) {
      const originalPet = { ...pet }
      this.ruleSystem.applyPetModifications(pet, context)

      // 检查是否有修改
      if (JSON.stringify(originalPet) !== JSON.stringify(pet)) {
        changes.push({
          type: 'modified',
          petId: pet.id,
          petName: pet.name,
          description: '精灵数据已根据规则自动调整',
          details: {
            original: originalPet,
            modified: pet,
          },
        })
      }
    }

    // 处理队伍大小问题
    const validation = this.ruleSystem.validateTeam(fixedTeam, context)
    const teamSizeErrors = validation.errors.filter(e => e.code === 'TEAM_TOO_LARGE' || e.code === 'TEAM_TOO_SMALL')

    for (const error of teamSizeErrors) {
      if (error.code === 'TEAM_TOO_LARGE') {
        const maxSize = error.context?.maxSize || 6
        const removedPets = fixedTeam.splice(maxSize)
        for (const removedPet of removedPets) {
          changes.push({
            type: 'removed',
            petId: removedPet.id,
            petName: removedPet.name,
            description: '因队伍大小限制被移除',
            details: { maxSize },
          })
        }
      }
    }

    // 重新验证修复后的队伍
    const remainingIssues = this.ruleSystem.validateTeam(fixedTeam, context)

    return {
      fixedTeam,
      changes,
      remainingIssues,
    }
  }

  /**
   * 获取规则限制信息
   * @param ruleSetIds 规则集ID列表
   * @returns 规则限制信息
   */
  getRuleLimitations(ruleSetIds: string[]): {
    teamSize: { min: number; max: number }
    levelRange: { min: number; max: number }
    evLimits: { totalMax: number; singleMax: number }
    bannedContent: {
      species: string[]
      skills: string[]
      marks: string[]
    }
    allowedContent?: {
      species: string[]
      skills: string[]
      marks: string[]
    }
    specialRestrictions: Array<{
      type: string
      description: string
      details: any
    }>
  } {
    // 默认限制
    const limitations = {
      teamSize: { min: 1, max: 6 },
      levelRange: { min: 1, max: 100 },
      evLimits: { totalMax: 510, singleMax: 252 },
      bannedContent: {
        species: [] as string[],
        skills: [] as string[],
        marks: [] as string[],
      },
      allowedContent: undefined as any,
      specialRestrictions: [] as Array<{
        type: string
        description: string
        details: any
      }>,
    }

    // 激活规则集并收集限制信息
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
        const ruleSet = this.registry.getRuleSet(ruleSetId)
        if (ruleSet) {
          // 分析规则集中的规则
          for (const rule of ruleSet.getEnabledRules()) {
            // 这里需要根据具体的规则类型来提取限制信息
            // 由于规则类型很多，这里只是示例实现
            if (rule.hasTag('team') && rule.hasTag('size')) {
              // 队伍大小规则
              const info = rule.getInfo() as any
              if (info.minSize !== undefined)
                limitations.teamSize.min = Math.max(limitations.teamSize.min, info.minSize)
              if (info.maxSize !== undefined)
                limitations.teamSize.max = Math.min(limitations.teamSize.max, info.maxSize)
            }

            if (rule.hasTag('level')) {
              // 等级限制规则
              const info = rule.getInfo() as any
              if (info.minLevel !== undefined)
                limitations.levelRange.min = Math.max(limitations.levelRange.min, info.minLevel)
              if (info.maxLevel !== undefined)
                limitations.levelRange.max = Math.min(limitations.levelRange.max, info.maxLevel)
            }

            if (rule.hasTag('ban')) {
              // 禁用规则
              limitations.specialRestrictions.push({
                type: 'ban',
                description: rule.description || '禁用特定内容',
                details: rule.getInfo(),
              })
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to analyze rule set ${ruleSetId}:`, error)
      }
    }

    return limitations
  }

  /**
   * 获取规则系统实例
   */
  getRuleSystem(): RuleSystem {
    return this.ruleSystem
  }

  /**
   * 获取规则注册表实例
   */
  getRegistry(): RuleRegistry {
    return this.registry
  }
}
