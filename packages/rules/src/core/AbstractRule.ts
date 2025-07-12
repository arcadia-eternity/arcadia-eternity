import type { TimerConfig } from '@arcadia-eternity/const'
import type { BaseSkill, BaseMark } from '@arcadia-eternity/battle'
import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import type {
  Rule,
  Team,
  RuleContext,
  BattleConfigModifications,
  AdditionalContent,
  RuleOptions,
} from '../interfaces/Rule'
import { RulePriority } from '../interfaces/Rule'
import { createSuccessResult, type ValidationResult } from '../interfaces/ValidationResult'

/**
 * 抽象规则基类
 * 提供规则的默认实现，子类可以选择性地重写需要的方法
 */
export abstract class AbstractRule implements Rule {
  public readonly id: string
  public readonly name: string
  public readonly description?: string
  public readonly priority: number
  public readonly version: string
  public readonly author?: string
  public readonly tags: string[]
  public enabled: boolean

  constructor(
    id: string,
    name: string,
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
    } = {},
  ) {
    this.id = id
    this.name = name
    this.description = options.description
    this.priority = options.priority ?? RulePriority.NORMAL
    this.version = options.version ?? '1.0.0'
    this.author = options.author
    this.tags = options.tags ?? []
    this.enabled = options.enabled ?? true
  }

  /**
   * 验证队伍 - 默认实现返回成功
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    return createSuccessResult()
  }

  /**
   * 验证精灵 - 默认实现返回成功
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult {
    return createSuccessResult()
  }

  /**
   * 验证技能 - 默认实现返回成功
   */
  validateSkill(pet: PetSchemaType, skill: BaseSkill, context?: RuleContext): ValidationResult {
    return createSuccessResult()
  }

  /**
   * 验证印记 - 默认实现返回成功
   */
  validateMark(pet: PetSchemaType, mark: BaseMark, context?: RuleContext): ValidationResult {
    return createSuccessResult()
  }

  /**
   * 修改精灵数据 - 默认实现不做任何修改
   */
  modifyPet(pet: PetSchemaType, context?: RuleContext): void {
    // 默认不做任何修改
  }

  /**
   * 修改技能数据 - 默认实现不做任何修改
   */
  modifySkill(skill: BaseSkill, context?: RuleContext): void {
    // 默认不做任何修改
  }

  /**
   * 修改印记数据 - 默认实现不做任何修改
   */
  modifyMark(mark: BaseMark, context?: RuleContext): void {
    // 默认不做任何修改
  }

  /**
   * 获取战斗配置修改 - 默认实现返回空对象
   */
  getBattleConfigModifications(context?: RuleContext): BattleConfigModifications {
    return {}
  }

  /**
   * 获取计时器配置修改 - 默认实现返回空对象
   */
  getTimerConfigModifications(context?: RuleContext): Partial<TimerConfig> {
    return {}
  }

  /**
   * 获取额外内容 - 默认实现返回空内容
   */
  getAdditionalContent(context?: RuleContext): AdditionalContent {
    return {
      skills: [],
      marks: [],
      species: [],
      effects: [],
      custom: {},
    }
  }

  /**
   * 获取特定种族的额外可学习技能 - 默认实现返回空数组
   */
  getSpeciesExtraLearnableSkills(speciesId: string, context?: RuleContext): LearnableSkill[] {
    return []
  }

  /**
   * 规则初始化 - 默认实现为空
   */
  async initialize(context?: RuleContext): Promise<void> {
    // 默认不需要初始化
  }

  /**
   * 规则清理 - 默认实现为空
   */
  async cleanup(context?: RuleContext): Promise<void> {
    // 默认不需要清理
  }

  /**
   * 检查规则是否适用于当前上下文 - 默认实现返回true
   */
  isApplicable(context?: RuleContext): boolean {
    return true
  }

  /**
   * 获取规则的字符串表示
   */
  toString(): string {
    return `Rule(${this.id}: ${this.name})`
  }

  /**
   * 获取规则的详细信息
   */
  getInfo(): RuleOptions {
    return {
      description: this.description,
      priority: this.priority,
      version: this.version,
      author: this.author,
      tags: [...this.tags],
      enabled: this.enabled,
    }
  }

  /**
   * 启用规则
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * 禁用规则
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * 切换规则启用状态
   */
  toggle(): void {
    this.enabled = !this.enabled
  }

  /**
   * 检查规则是否有指定标签
   */
  hasTag(tag: string): boolean {
    return this.tags.includes(tag)
  }

  /**
   * 检查规则是否有任意指定标签
   */
  hasAnyTag(tags: string[]): boolean {
    return tags.some(tag => this.tags.includes(tag))
  }

  /**
   * 检查规则是否有所有指定标签
   */
  hasAllTags(tags: string[]): boolean {
    return tags.every(tag => this.tags.includes(tag))
  }
}
