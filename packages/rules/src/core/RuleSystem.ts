import type { TimerConfig } from '@arcadia-eternity/const'
import type { BaseSkill, BaseMark } from '@arcadia-eternity/battle'
import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import type { Rule, Team, RuleContext, BattleConfigModifications, AdditionalContent } from '../interfaces/Rule'
import type { RuleSet } from '../interfaces/RuleSet'
import { ValidationResultBuilder, type ValidationResult } from '../interfaces/ValidationResult'
import { RuleRegistry } from './RuleRegistry'

/**
 * 规则系统主类
 * 提供规则应用、验证和管理的统一入口
 */
export class RuleSystem {
  private registry: RuleRegistry
  private activeRuleSets = new Set<string>()
  private context: RuleContext | null = null

  constructor(registry?: RuleRegistry) {
    this.registry = registry || RuleRegistry.getInstance()
  }

  /**
   * 设置当前上下文
   * @param context 规则上下文
   */
  setContext(context: RuleContext): void {
    this.context = context
  }

  /**
   * 获取当前上下文
   * @returns 当前上下文
   */
  getContext(): RuleContext | null {
    return this.context
  }

  /**
   * 激活规则集
   * @param ruleSetId 规则集ID
   */
  activateRuleSet(ruleSetId: string): void {
    const ruleSet = this.registry.getRuleSet(ruleSetId)
    if (!ruleSet) {
      throw new Error(`RuleSet with id "${ruleSetId}" not found`)
    }

    if (!ruleSet.enabled) {
      throw new Error(`RuleSet "${ruleSetId}" is disabled`)
    }

    this.activeRuleSets.add(ruleSetId)
  }

  /**
   * 停用规则集
   * @param ruleSetId 规则集ID
   */
  deactivateRuleSet(ruleSetId: string): void {
    this.activeRuleSets.delete(ruleSetId)
  }

  /**
   * 获取激活的规则集
   * @returns 激活的规则集列表
   */
  getActiveRuleSets(): RuleSet[] {
    return Array.from(this.activeRuleSets)
      .map(id => this.registry.getRuleSet(id))
      .filter((ruleSet): ruleSet is RuleSet => ruleSet !== undefined)
  }

  /**
   * 获取所有激活的规则
   * @returns 激活的规则列表（按优先级排序）
   */
  getActiveRules(): Rule[] {
    const rules = new Map<string, Rule>()

    // 收集所有激活规则集中的规则
    for (const ruleSet of this.getActiveRuleSets()) {
      for (const rule of ruleSet.getEnabledRules()) {
        if (rule.isApplicable?.(this.context || undefined) !== false) {
          rules.set(rule.id, rule)
        }
      }
    }

    // 按优先级排序
    return Array.from(rules.values()).sort((a, b) => b.priority - a.priority)
  }

  /**
   * 验证队伍
   * @param team 队伍数据
   * @param context 可选的上下文覆盖
   * @returns 验证结果
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    const ctx = context || this.context || undefined
    const builder = new ValidationResultBuilder()

    for (const rule of this.getActiveRules()) {
      const result = rule.validateTeam(team, ctx)
      builder.merge(result)
    }

    return builder.build()
  }

  /**
   * 验证精灵
   * @param pet 精灵数据
   * @param context 可选的上下文覆盖
   * @returns 验证结果
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult {
    const ctx = context || this.context || undefined
    const builder = new ValidationResultBuilder()

    for (const rule of this.getActiveRules()) {
      const result = rule.validatePet(pet, ctx)
      builder.merge(result)
    }

    return builder.build()
  }

  /**
   * 验证技能
   * @param pet 精灵数据
   * @param skill 技能数据
   * @param context 可选的上下文覆盖
   * @returns 验证结果
   */
  validateSkill(pet: PetSchemaType, skill: BaseSkill, context?: RuleContext): ValidationResult {
    const ctx = context || this.context || undefined
    const builder = new ValidationResultBuilder()

    for (const rule of this.getActiveRules()) {
      const result = rule.validateSkill(pet, skill, ctx)
      builder.merge(result)
    }

    return builder.build()
  }

  /**
   * 验证印记
   * @param pet 精灵数据
   * @param mark 印记数据
   * @param context 可选的上下文覆盖
   * @returns 验证结果
   */
  validateMark(pet: PetSchemaType, mark: BaseMark, context?: RuleContext): ValidationResult {
    const ctx = context || this.context || undefined
    const builder = new ValidationResultBuilder()

    for (const rule of this.getActiveRules()) {
      const result = rule.validateMark(pet, mark, ctx)
      builder.merge(result)
    }

    return builder.build()
  }

  /**
   * 应用规则修改到精灵
   * @param pet 精灵数据
   * @param context 可选的上下文覆盖
   */
  applyPetModifications(pet: PetSchemaType, context?: RuleContext): void {
    const ctx = context || this.context || undefined

    for (const rule of this.getActiveRules()) {
      rule.modifyPet(pet, ctx)
    }
  }

  /**
   * 应用规则修改到技能
   * @param skill 技能数据
   * @param context 可选的上下文覆盖
   */
  applySkillModifications(skill: BaseSkill, context?: RuleContext): void {
    const ctx = context || this.context || undefined

    for (const rule of this.getActiveRules()) {
      rule.modifySkill(skill, ctx)
    }
  }

  /**
   * 应用规则修改到印记
   * @param mark 印记数据
   * @param context 可选的上下文覆盖
   */
  applyMarkModifications(mark: BaseMark, context?: RuleContext): void {
    const ctx = context || this.context || undefined

    for (const rule of this.getActiveRules()) {
      rule.modifyMark(mark, ctx)
    }
  }

  /**
   * 获取战斗配置修改
   * @param context 可选的上下文覆盖
   * @returns 合并后的战斗配置修改
   */
  getBattleConfigModifications(context?: RuleContext): BattleConfigModifications {
    const ctx = context || this.context || undefined
    const modifications: BattleConfigModifications = {}

    for (const rule of this.getActiveRules()) {
      const ruleMods = rule.getBattleConfigModifications(ctx)
      Object.assign(modifications, ruleMods)
    }

    return modifications
  }

  /**
   * 获取计时器配置修改
   * @param context 可选的上下文覆盖
   * @returns 合并后的计时器配置修改
   */
  getTimerConfigModifications(context?: RuleContext): Partial<TimerConfig> {
    const ctx = context || this.context || undefined
    const modifications: Partial<TimerConfig> = {}

    for (const rule of this.getActiveRules()) {
      const ruleMods = rule.getTimerConfigModifications(ctx)
      Object.assign(modifications, ruleMods)
    }

    return modifications
  }

  /**
   * 获取额外内容
   * @param context 可选的上下文覆盖
   * @returns 合并后的额外内容
   */
  getAdditionalContent(context?: RuleContext): AdditionalContent {
    const ctx = context || this.context || undefined
    const content: AdditionalContent = {
      skills: [],
      marks: [],
      species: [],
      effects: [],
      custom: {},
    }

    for (const rule of this.getActiveRules()) {
      const ruleContent = rule.getAdditionalContent(ctx)

      if (ruleContent.skills) {
        content.skills!.push(...ruleContent.skills)
      }
      if (ruleContent.marks) {
        content.marks!.push(...ruleContent.marks)
      }
      if (ruleContent.species) {
        content.species!.push(...ruleContent.species)
      }
      if (ruleContent.effects) {
        content.effects!.push(...ruleContent.effects)
      }
      if (ruleContent.custom) {
        Object.assign(content.custom!, ruleContent.custom)
      }
    }

    return content
  }

  /**
   * 获取特定种族的额外可学习技能（仅在队伍构建验证过程中生效）
   * @param speciesId 种族ID
   * @param context 可选的上下文覆盖
   * @returns 合并后的额外可学习技能列表
   */
  getSpeciesExtraLearnableSkills(speciesId: string, context?: RuleContext): LearnableSkill[] {
    const ctx = context || this.context || undefined
    const extraSkills: LearnableSkill[] = []

    for (const rule of this.getActiveRules()) {
      if (rule.getSpeciesExtraLearnableSkills) {
        const ruleSkills = rule.getSpeciesExtraLearnableSkills(speciesId, ctx)
        extraSkills.push(...ruleSkills)
      }
    }

    return extraSkills
  }

  /**
   * 初始化规则系统
   * @param context 可选的上下文覆盖
   */
  async initialize(context?: RuleContext): Promise<void> {
    const ctx = context || this.context || undefined

    for (const rule of this.getActiveRules()) {
      if (rule.initialize) {
        await rule.initialize(ctx)
      }
    }
  }

  /**
   * 清理规则系统
   * @param context 可选的上下文覆盖
   */
  async cleanup(context?: RuleContext): Promise<void> {
    const ctx = context || this.context || undefined

    for (const rule of this.getActiveRules()) {
      if (rule.cleanup) {
        await rule.cleanup(ctx)
      }
    }
  }

  /**
   * 清空所有激活的规则集
   */
  clearActiveRuleSets(): void {
    this.activeRuleSets.clear()
  }

  /**
   * 检查规则集是否激活
   * @param ruleSetId 规则集ID
   * @returns 是否激活
   */
  isRuleSetActive(ruleSetId: string): boolean {
    return this.activeRuleSets.has(ruleSetId)
  }
}
