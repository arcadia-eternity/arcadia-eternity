import type { Rule, RuleContext } from '../interfaces/Rule'
import type { RuleSet } from '../interfaces/RuleSet'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../interfaces/ValidationResult'

/**
 * 规则注册表
 * 管理所有规则和规则集的注册、查找和生命周期
 */
export class RuleRegistry {
  private static instance: RuleRegistry | null = null

  /** 注册的规则映射 */
  private rules = new Map<string, Rule>()

  /** 注册的规则集映射 */
  private ruleSets = new Map<string, RuleSet>()

  /** 规则依赖关系 */
  private ruleDependencies = new Map<string, Set<string>>()

  /** 规则集依赖关系 */
  private ruleSetDependencies = new Map<string, Set<string>>()

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): RuleRegistry {
    if (!RuleRegistry.instance) {
      RuleRegistry.instance = new RuleRegistry()
    }
    return RuleRegistry.instance
  }

  /**
   * 注册规则
   * @param rule 要注册的规则
   * @param dependencies 依赖的规则ID列表
   */
  registerRule(rule: Rule, dependencies: string[] = []): void {
    if (this.rules.has(rule.id)) {
      throw new Error(`Rule with id "${rule.id}" is already registered`)
    }

    // 验证依赖关系
    for (const depId of dependencies) {
      if (!this.rules.has(depId)) {
        throw new Error(`Dependency rule "${depId}" not found for rule "${rule.id}"`)
      }
    }

    this.rules.set(rule.id, rule)
    this.ruleDependencies.set(rule.id, new Set(dependencies))
  }

  /**
   * 注册规则集
   * @param ruleSet 要注册的规则集
   * @param dependencies 依赖的规则集ID列表
   */
  registerRuleSet(ruleSet: RuleSet, dependencies: string[] = []): void {
    if (this.ruleSets.has(ruleSet.id)) {
      throw new Error(`RuleSet with id "${ruleSet.id}" is already registered`)
    }

    // 验证规则集中的所有规则都已注册
    for (const rule of ruleSet.rules) {
      if (!this.rules.has(rule.id)) {
        throw new Error(`Rule "${rule.id}" in RuleSet "${ruleSet.id}" is not registered`)
      }
    }

    // 验证依赖关系
    for (const depId of dependencies) {
      if (!this.ruleSets.has(depId)) {
        throw new Error(`Dependency RuleSet "${depId}" not found for RuleSet "${ruleSet.id}"`)
      }
    }

    this.ruleSets.set(ruleSet.id, ruleSet)
    this.ruleSetDependencies.set(ruleSet.id, new Set(dependencies))
  }

  /**
   * 获取规则
   * @param ruleId 规则ID
   * @returns 规则实例，如果不存在则返回undefined
   */
  getRule(ruleId: string): Rule | undefined {
    return this.rules.get(ruleId)
  }

  /**
   * 获取规则集
   * @param ruleSetId 规则集ID
   * @returns 规则集实例，如果不存在则返回undefined
   */
  getRuleSet(ruleSetId: string): RuleSet | undefined {
    return this.ruleSets.get(ruleSetId)
  }

  /**
   * 获取所有规则
   * @returns 规则列表
   */
  getAllRules(): Rule[] {
    return Array.from(this.rules.values())
  }

  /**
   * 获取所有规则集
   * @returns 规则集列表
   */
  getAllRuleSets(): RuleSet[] {
    return Array.from(this.ruleSets.values())
  }

  /**
   * 获取启用的规则
   * @returns 启用的规则列表
   */
  getEnabledRules(): Rule[] {
    return Array.from(this.rules.values()).filter(rule => rule.enabled)
  }

  /**
   * 获取启用的规则集
   * @returns 启用的规则集列表
   */
  getEnabledRuleSets(): RuleSet[] {
    return Array.from(this.ruleSets.values()).filter(ruleSet => ruleSet.enabled)
  }

  /**
   * 按标签查找规则
   * @param tags 标签列表
   * @returns 匹配的规则列表
   */
  getRulesByTags(tags: string[]): Rule[] {
    return Array.from(this.rules.values()).filter(rule => tags.some(tag => rule.tags.includes(tag)))
  }

  /**
   * 按标签查找规则集
   * @param tags 标签列表
   * @returns 匹配的规则集列表
   */
  getRuleSetsByTags(tags: string[]): RuleSet[] {
    return Array.from(this.ruleSets.values()).filter(ruleSet => tags.some(tag => ruleSet.tags.includes(tag)))
  }

  /**
   * 检查规则是否存在
   * @param ruleId 规则ID
   * @returns 是否存在
   */
  hasRule(ruleId: string): boolean {
    return this.rules.has(ruleId)
  }

  /**
   * 检查规则集是否存在
   * @param ruleSetId 规则集ID
   * @returns 是否存在
   */
  hasRuleSet(ruleSetId: string): boolean {
    return this.ruleSets.has(ruleSetId)
  }

  /**
   * 注销规则
   * @param ruleId 规则ID
   */
  unregisterRule(ruleId: string): void {
    // 检查是否有其他规则依赖此规则
    for (const [id, deps] of this.ruleDependencies.entries()) {
      if (deps.has(ruleId) && id !== ruleId) {
        throw new Error(`Cannot unregister rule "${ruleId}" because it is depended on by rule "${id}"`)
      }
    }

    this.rules.delete(ruleId)
    this.ruleDependencies.delete(ruleId)
  }

  /**
   * 注销规则集
   * @param ruleSetId 规则集ID
   */
  unregisterRuleSet(ruleSetId: string): void {
    // 检查是否有其他规则集依赖此规则集
    for (const [id, deps] of this.ruleSetDependencies.entries()) {
      if (deps.has(ruleSetId) && id !== ruleSetId) {
        throw new Error(`Cannot unregister RuleSet "${ruleSetId}" because it is depended on by RuleSet "${id}"`)
      }
    }

    this.ruleSets.delete(ruleSetId)
    this.ruleSetDependencies.delete(ruleSetId)
  }

  /**
   * 清空所有注册的规则和规则集
   */
  clear(): void {
    this.rules.clear()
    this.ruleSets.clear()
    this.ruleDependencies.clear()
    this.ruleSetDependencies.clear()
  }

  /**
   * 验证注册表的完整性
   * @returns 验证结果
   */
  validateRegistry(): ValidationResult {
    const builder = new ValidationResultBuilder()

    // 检查规则依赖关系
    for (const [ruleId, deps] of this.ruleDependencies.entries()) {
      for (const depId of deps) {
        if (!this.rules.has(depId)) {
          builder.addError(
            ValidationErrorType.SYSTEM_ERROR,
            'MISSING_RULE_DEPENDENCY',
            `Rule "${ruleId}" depends on missing rule "${depId}"`,
            ruleId,
            'rule',
          )
        }
      }
    }

    // 检查规则集依赖关系
    for (const [ruleSetId, deps] of this.ruleSetDependencies.entries()) {
      for (const depId of deps) {
        if (!this.ruleSets.has(depId)) {
          builder.addError(
            ValidationErrorType.SYSTEM_ERROR,
            'MISSING_RULESET_DEPENDENCY',
            `RuleSet "${ruleSetId}" depends on missing RuleSet "${depId}"`,
            ruleSetId,
            'ruleSet',
          )
        }
      }
    }

    return builder.build()
  }

  /**
   * 获取规则的依赖关系
   * @param ruleId 规则ID
   * @returns 依赖的规则ID集合
   */
  getRuleDependencies(ruleId: string): Set<string> {
    return this.ruleDependencies.get(ruleId) || new Set()
  }

  /**
   * 获取规则集的依赖关系
   * @param ruleSetId 规则集ID
   * @returns 依赖的规则集ID集合
   */
  getRuleSetDependencies(ruleSetId: string): Set<string> {
    return this.ruleSetDependencies.get(ruleSetId) || new Set()
  }
}
