import type { TimerConfig } from '@arcadia-eternity/const'
import type { Battle, Pet, BaseSkill, BaseMark } from '@arcadia-eternity/battle'
import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import type { ValidationResult } from './ValidationResult'

/**
 * 队伍类型定义（基于schema中的定义）
 */
export type Team = PetSchemaType[]

/**
 * 战斗配置修改
 */
export interface BattleConfigModifications {
  /** 是否允许濒死切换 */
  allowFaintSwitch?: boolean
  /** 是否显示隐藏技能 */
  showHidden?: boolean
  /** 随机数种子 */
  rngSeed?: number
  /** 其他自定义配置 */
  customConfig?: Record<string, any>
}

/**
 * 额外内容定义
 */
export interface AdditionalContent {
  /** 额外的技能 */
  skills?: BaseSkill[]
  /** 额外的印记 */
  marks?: BaseMark[]
  /** 额外的精灵种族 */
  species?: any[]
  /** 额外的效果 */
  effects?: any[]
  /** 自定义内容 */
  custom?: Record<string, any>
}

/**
 * 规则上下文
 */
export interface RuleContext {
  /** 当前战斗实例 */
  battle?: Battle
  /** 规则应用的阶段 */
  phase: RulePhase
  /** 额外的上下文数据 */
  data?: Record<string, any>
}

/**
 * 规则应用阶段
 */
export enum RulePhase {
  /** 队伍构建阶段 */
  TEAM_BUILDING = 'team_building',
  /** 战斗准备阶段 */
  BATTLE_PREPARATION = 'battle_preparation',
  /** 战斗进行阶段 */
  BATTLE_EXECUTION = 'battle_execution',
  /** 战斗结束阶段 */
  BATTLE_END = 'battle_end',
}

/**
 * 规则优先级
 */
export enum RulePriority {
  /** 最高优先级 */
  HIGHEST = 1000,
  /** 高优先级 */
  HIGH = 800,
  /** 普通优先级 */
  NORMAL = 500,
  /** 低优先级 */
  LOW = 200,
  /** 最低优先级 */
  LOWEST = 0,
}

/**
 * 规则选项
 */
export interface RuleOptions {
  /** 规则描述 */
  description?: string
  /** 规则优先级 */
  priority?: number
  /** 规则版本 */
  version?: string
  /** 规则作者 */
  author?: string
  /** 规则标签 */
  tags?: string[]
  /** 是否启用 */
  enabled?: boolean
}

/**
 * 规则接口
 */
export interface Rule {
  /** 规则唯一标识符 */
  readonly id: string
  /** 规则名称 */
  readonly name: string
  /** 规则描述 */
  readonly description?: string
  /** 规则优先级 */
  readonly priority: number
  /** 规则版本 */
  readonly version: string
  /** 规则作者 */
  readonly author?: string
  /** 规则标签 */
  readonly tags: string[]
  /** 是否启用 */
  enabled: boolean

  /**
   * 检查是否包含指定标签
   * @param tag 标签名
   * @returns 是否包含标签
   */
  hasTag(tag: string): boolean

  /**
   * 获取规则信息
   * @returns 规则选项信息
   */
  getInfo(): RuleOptions

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
   * 验证技能
   * @param pet 精灵数据
   * @param skill 技能数据
   * @param context 规则上下文
   * @returns 验证结果
   */
  validateSkill(pet: PetSchemaType, skill: BaseSkill, context?: RuleContext): ValidationResult

  /**
   * 验证印记
   * @param pet 精灵数据
   * @param mark 印记数据
   * @param context 规则上下文
   * @returns 验证结果
   */
  validateMark(pet: PetSchemaType, mark: BaseMark, context?: RuleContext): ValidationResult

  /**
   * 修改精灵数据
   * @param pet 精灵数据
   * @param context 规则上下文
   */
  modifyPet(pet: PetSchemaType, context?: RuleContext): void

  /**
   * 修改技能数据
   * @param skill 技能数据
   * @param context 规则上下文
   */
  modifySkill(skill: BaseSkill, context?: RuleContext): void

  /**
   * 修改印记数据
   * @param mark 印记数据
   * @param context 规则上下文
   */
  modifyMark(mark: BaseMark, context?: RuleContext): void

  /**
   * 获取战斗配置修改
   * @param context 规则上下文
   * @returns 战斗配置修改
   */
  getBattleConfigModifications(context?: RuleContext): BattleConfigModifications

  /**
   * 获取计时器配置修改
   * @param context 规则上下文
   * @returns 计时器配置修改
   */
  getTimerConfigModifications(context?: RuleContext): Partial<TimerConfig>

  /**
   * 获取额外内容
   * @param context 规则上下文
   * @returns 额外内容
   */
  getAdditionalContent(context?: RuleContext): AdditionalContent

  /**
   * 获取特定种族的额外可学习技能（仅在队伍构建验证过程中生效）
   * @param speciesId 种族ID
   * @param context 规则上下文
   * @returns 额外可学习技能列表
   */
  getSpeciesExtraLearnableSkills?(speciesId: string, context?: RuleContext): LearnableSkill[]

  /**
   * 规则初始化
   * @param context 规则上下文
   */
  initialize?(context?: RuleContext): void | Promise<void>

  /**
   * 规则清理
   * @param context 规则上下文
   */
  cleanup?(context?: RuleContext): void | Promise<void>

  /**
   * 检查规则是否适用于当前上下文
   * @param context 规则上下文
   * @returns 是否适用
   */
  isApplicable?(context?: RuleContext): boolean
}
