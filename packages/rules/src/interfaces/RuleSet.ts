import type { Rule, Team, RuleContext } from './Rule'
import type { ValidationResult } from './ValidationResult'
import type { PetSchemaType } from '@arcadia-eternity/schema'

/**
 * 规则集接口
 */
export interface RuleSet {
  /** 规则集唯一标识符 */
  readonly id: string
  /** 规则集名称 */
  readonly name: string
  /** 规则集描述 */
  readonly description?: string
  /** 规则集版本 */
  readonly version: string
  /** 规则集作者 */
  readonly author?: string
  /** 规则集标签 */
  readonly tags: string[]
  /** 是否启用 */
  enabled: boolean
  /** 包含的规则列表 */
  readonly rules: Rule[]

  /**
   * 添加规则
   * @param rule 要添加的规则
   */
  addRule(rule: Rule): void

  /**
   * 移除规则
   * @param ruleId 要移除的规则ID
   */
  removeRule(ruleId: string): void

  /**
   * 获取规则
   * @param ruleId 规则ID
   * @returns 规则实例，如果不存在则返回undefined
   */
  getRule(ruleId: string): Rule | undefined

  /**
   * 获取所有规则
   * @returns 规则列表
   */
  getRules(): Rule[]

  /**
   * 获取启用的规则
   * @returns 启用的规则列表
   */
  getEnabledRules(): Rule[]

  /**
   * 验证队伍
   * @param team 队伍数据
   * @param context 规则上下文
   * @returns 验证结果
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult

  /**
   * 验证精灵
   * @param pet 精灵数据
   * @param context 规则上下文
   * @returns 验证结果
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult

  /**
   * 启用规则
   * @param ruleId 规则ID
   */
  enableRule(ruleId: string): void

  /**
   * 禁用规则
   * @param ruleId 规则ID
   */
  disableRule(ruleId: string): void

  /**
   * 检查规则是否存在
   * @param ruleId 规则ID
   * @returns 是否存在
   */
  hasRule(ruleId: string): boolean

  /**
   * 清空所有规则
   */
  clearRules(): void

  /**
   * 规则集初始化
   * @param context 规则上下文
   */
  initialize?(context?: RuleContext): void | Promise<void>

  /**
   * 规则集清理
   * @param context 规则上下文
   */
  cleanup?(context?: RuleContext): void | Promise<void>

  /**
   * 克隆规则集
   * @returns 新的规则集实例
   */
  clone(): RuleSet
}

/**
 * 规则集配置
 */
export interface RuleSetConfig {
  /** 规则集ID */
  id: string
  /** 规则集名称 */
  name: string
  /** 规则集描述 */
  description?: string
  /** 规则集版本 */
  version: string
  /** 规则集作者 */
  author?: string
  /** 规则集标签 */
  tags?: string[]
  /** 是否启用 */
  enabled?: boolean
  /** 规则ID列表 */
  ruleIds: string[]
  /** 规则配置覆盖 */
  ruleOverrides?: Record<string, Partial<Rule>>
}

/**
 * 规则集构建器
 */
export interface RuleSetBuilder {
  /**
   * 设置规则集ID
   * @param id 规则集ID
   * @returns 构建器实例
   */
  setId(id: string): RuleSetBuilder

  /**
   * 设置规则集名称
   * @param name 规则集名称
   * @returns 构建器实例
   */
  setName(name: string): RuleSetBuilder

  /**
   * 设置规则集描述
   * @param description 规则集描述
   * @returns 构建器实例
   */
  setDescription(description: string): RuleSetBuilder

  /**
   * 设置规则集版本
   * @param version 规则集版本
   * @returns 构建器实例
   */
  setVersion(version: string): RuleSetBuilder

  /**
   * 设置规则集作者
   * @param author 规则集作者
   * @returns 构建器实例
   */
  setAuthor(author: string): RuleSetBuilder

  /**
   * 添加标签
   * @param tags 标签列表
   * @returns 构建器实例
   */
  addTags(...tags: string[]): RuleSetBuilder

  /**
   * 添加规则
   * @param rules 规则列表
   * @returns 构建器实例
   */
  addRules(...rules: Rule[]): RuleSetBuilder

  /**
   * 设置启用状态
   * @param enabled 是否启用
   * @returns 构建器实例
   */
  setEnabled(enabled: boolean): RuleSetBuilder

  /**
   * 构建规则集
   * @returns 规则集实例
   */
  build(): RuleSet
}
