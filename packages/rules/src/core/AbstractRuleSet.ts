import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Rule, Team, RuleContext } from '../interfaces/Rule'
import type { RuleSet, RuleSetBuilder, MatchingConfig } from '../interfaces/RuleSet'
import { ValidationResultBuilder, type ValidationResult } from '../interfaces/ValidationResult'

/**
 * 抽象规则集基类
 * 提供规则集的默认实现
 */
export abstract class AbstractRuleSet implements RuleSet {
  public readonly id: string
  public readonly name: string
  public readonly description?: string
  public readonly version: string
  public readonly author?: string
  public readonly tags: string[]
  public enabled: boolean
  public readonly rules: Rule[]
  public readonly matchingConfig?: MatchingConfig

  constructor(
    id: string,
    name: string,
    options: {
      description?: string
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
      rules?: Rule[]
      matchingConfig?: MatchingConfig
    } = {},
  ) {
    this.id = id
    this.name = name
    this.description = options.description
    this.version = options.version ?? '1.0.0'
    this.author = options.author
    this.tags = options.tags ?? []
    this.enabled = options.enabled ?? true
    this.rules = options.rules ?? []
    this.matchingConfig = options.matchingConfig
  }

  /**
   * 添加规则
   */
  addRule(rule: Rule): void {
    if (this.rules.find(r => r.id === rule.id)) {
      throw new Error(`Rule with id "${rule.id}" already exists in RuleSet "${this.id}"`)
    }
    this.rules.push(rule)
  }

  /**
   * 移除规则
   */
  removeRule(ruleId: string): void {
    const index = this.rules.findIndex(r => r.id === ruleId)
    if (index === -1) {
      throw new Error(`Rule with id "${ruleId}" not found in RuleSet "${this.id}"`)
    }
    this.rules.splice(index, 1)
  }

  /**
   * 获取规则
   */
  getRule(ruleId: string): Rule | undefined {
    return this.rules.find(r => r.id === ruleId)
  }

  /**
   * 获取所有规则
   */
  getRules(): Rule[] {
    return [...this.rules]
  }

  /**
   * 获取启用的规则
   */
  getEnabledRules(): Rule[] {
    return this.rules.filter(rule => rule.enabled)
  }

  /**
   * 验证队伍
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    for (const rule of this.getEnabledRules()) {
      if (rule.isApplicable?.(context) !== false) {
        const result = rule.validateTeam(team, context)
        builder.merge(result)
      }
    }

    return builder.build()
  }

  /**
   * 验证精灵
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    for (const rule of this.getEnabledRules()) {
      if (rule.isApplicable?.(context) !== false) {
        const result = rule.validatePet(pet, context)
        builder.merge(result)
      }
    }

    return builder.build()
  }

  /**
   * 启用规则
   */
  enableRule(ruleId: string): void {
    const rule = this.getRule(ruleId)
    if (!rule) {
      throw new Error(`Rule with id "${ruleId}" not found in RuleSet "${this.id}"`)
    }
    rule.enabled = true
  }

  /**
   * 禁用规则
   */
  disableRule(ruleId: string): void {
    const rule = this.getRule(ruleId)
    if (!rule) {
      throw new Error(`Rule with id "${ruleId}" not found in RuleSet "${this.id}"`)
    }
    rule.enabled = false
  }

  /**
   * 检查规则是否存在
   */
  hasRule(ruleId: string): boolean {
    return this.rules.some(r => r.id === ruleId)
  }

  /**
   * 清空所有规则
   */
  clearRules(): void {
    this.rules.length = 0
  }

  /**
   * 规则集初始化
   */
  async initialize(context?: RuleContext): Promise<void> {
    for (const rule of this.getEnabledRules()) {
      if (rule.initialize) {
        await rule.initialize(context)
      }
    }
  }

  /**
   * 规则集清理
   */
  async cleanup(context?: RuleContext): Promise<void> {
    for (const rule of this.getEnabledRules()) {
      if (rule.cleanup) {
        await rule.cleanup(context)
      }
    }
  }

  /**
   * 克隆规则集
   */
  clone(): RuleSet {
    return new (this.constructor as any)(this.id + '_clone', this.name + ' (Clone)', {
      description: this.description,
      version: this.version,
      author: this.author,
      tags: [...this.tags],
      enabled: this.enabled,
      rules: [...this.rules],
    })
  }

  /**
   * 获取规则集的字符串表示
   */
  toString(): string {
    return `RuleSet(${this.id}: ${this.name}, ${this.rules.length} rules)`
  }

  /**
   * 获取规则集的详细信息
   */
  getInfo(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      author: this.author,
      tags: this.tags,
      enabled: this.enabled,
      ruleCount: this.rules.length,
      enabledRuleCount: this.getEnabledRules().length,
      rules: this.rules.map(r => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        priority: r.priority,
      })),
    }
  }

  /**
   * 启用规则集
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * 禁用规则集
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * 切换规则集启用状态
   */
  toggle(): void {
    this.enabled = !this.enabled
  }

  /**
   * 检查规则集是否有指定标签
   */
  hasTag(tag: string): boolean {
    return this.tags.includes(tag)
  }

  /**
   * 按标签获取规则
   */
  getRulesByTag(tag: string): Rule[] {
    return this.rules.filter(rule => rule.tags.includes(tag))
  }

  /**
   * 按优先级排序规则
   */
  getRulesSortedByPriority(): Rule[] {
    return [...this.rules].sort((a, b) => b.priority - a.priority)
  }
}

/**
 * 具体的规则集实现
 */
export class RuleSetImpl extends AbstractRuleSet {
  constructor(
    id: string,
    name: string,
    options: {
      description?: string
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
      rules?: Rule[]
      matchingConfig?: MatchingConfig
    } = {},
  ) {
    super(id, name, options)
  }
}

/**
 * 规则集构建器实现
 */
export class RuleSetBuilderImpl implements RuleSetBuilder {
  private id: string = ''
  private name: string = ''
  private description?: string
  private version: string = '1.0.0'
  private author?: string
  private tags: string[] = []
  private rules: Rule[] = []
  private enabled: boolean = true

  setId(id: string): RuleSetBuilder {
    this.id = id
    return this
  }

  setName(name: string): RuleSetBuilder {
    this.name = name
    return this
  }

  setDescription(description: string): RuleSetBuilder {
    this.description = description
    return this
  }

  setVersion(version: string): RuleSetBuilder {
    this.version = version
    return this
  }

  setAuthor(author: string): RuleSetBuilder {
    this.author = author
    return this
  }

  addTags(...tags: string[]): RuleSetBuilder {
    this.tags.push(...tags)
    return this
  }

  addRules(...rules: Rule[]): RuleSetBuilder {
    this.rules.push(...rules)
    return this
  }

  setEnabled(enabled: boolean): RuleSetBuilder {
    this.enabled = enabled
    return this
  }

  build(): RuleSet {
    if (!this.id) {
      throw new Error('RuleSet id is required')
    }
    if (!this.name) {
      throw new Error('RuleSet name is required')
    }

    return new RuleSetImpl(this.id, this.name, {
      description: this.description,
      version: this.version,
      author: this.author,
      tags: this.tags,
      enabled: this.enabled,
      rules: this.rules,
    })
  }
}
