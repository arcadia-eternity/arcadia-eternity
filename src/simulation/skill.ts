import { BattleSystem, Player, UseSkillContext } from './battleSystem'
import { AttackTargetOpinion } from './const'
import { Pet } from './pet'
import { Type } from './type'

export enum EffectTriggerPhase {
  PRE_DAMAGE = 'PRE_DAMAGE',
  POST_DAMAGE = 'POST_DAMAGE',
  ON_HIT = 'ON_HIT',
  ON_CRIT_PRE_DAMAGE = 'ON_CRIT_PRE_DAMAGE',
  ON_CRIT_POST_DAMAGE = 'ON_CRIT_POST_DAMAGE',
  ON_MISS = 'ON_MISS',
  ON_DEFEAT = 'ON_DEFEAT',
}

export interface SkillEffect {
  phase: EffectTriggerPhase
  apply(context: UseSkillContext): void
  probability?: number // 触发概率（0-1）
  condition?: (context: UseSkillContext) => boolean // 新增触发条件
}

export enum SkillType {
  Physical = 'Physical',
  Special = 'Special',
  Status = 'Status',
  Climax = 'Climax',
}

// 技能类
export class Skill {
  constructor(
    public readonly name: string,
    public readonly SkillType: SkillType,
    public readonly type: Type,
    public readonly power: number,
    public readonly accuracy: number,
    public readonly rageCost: number,
    public readonly priority: number,
    public readonly target: AttackTargetOpinion = AttackTargetOpinion.self,

    public readonly effects?: SkillEffect[], // 可选特效
    public readonly sureHit: boolean = false,
  ) {}

  public applyEffects(battle: BattleSystem, phase: EffectTriggerPhase, context: UseSkillContext) {
    if (!this.effects) return
    this.effects
      .filter(effect => effect.phase === phase && (effect.condition ? effect.condition(context) : true))
      .forEach(effect => {
        if (Math.random() < (effect.probability ?? 1)) {
          effect.apply(context)
        }
      })
  }

  static builder() {
    return new SkillBuilder()
  }
}

class SkillBuilder {
  private name = ''
  private SkillType = SkillType.Physical
  private type = Type.Normal
  private power = 0
  private accuracy = 1
  private rageCost = 0
  private priority = 0
  private effects: SkillEffect[] = []
  private attackTarget: AttackTargetOpinion = AttackTargetOpinion.opponent

  withName(name: string) {
    this.name = name
    return this
  }

  withType(type: Type) {
    this.type = type
    return this
  }

  withPower(power: number) {
    this.power = power
    return this
  }

  withAccuracy(accuracy: number) {
    this.accuracy = accuracy
    return this
  }

  withRageCost(rageCost: number) {
    this.rageCost = rageCost
    return this
  }

  withEffect(effect: SkillEffect) {
    this.effects.push(effect)
    return this
  }

  withAttackTarget(attackTarget: AttackTargetOpinion) {
    this.attackTarget = attackTarget
    return this
  }

  withConditionalEffect(effect: Omit<SkillEffect, 'condition'>, condition: (context: UseSkillContext) => boolean) {
    this.effects.push({ ...effect, condition })
    return this
  }

  build() {
    return new Skill(
      this.name,
      this.SkillType,
      this.type,
      this.power,
      this.accuracy,
      this.rageCost,
      this.priority,
      this.attackTarget,
      this.effects,
    )
  }
}

// 条件系统分为三个层级
export type TargetSelector<T> = (context: UseSkillContext) => T[] // 选择目标对象
export type ValueExtractor<T> = (target: T) => boolean // 提取目标属性值
export type ConditionOperator = (values: boolean[]) => boolean // 判断逻辑

// 条件工厂
export class ConditionFactory {
  // 基础构造器
  static createCondition<T>(
    selector: TargetSelector<T>,
    extractor: ValueExtractor<T>,
    operator: ConditionOperator,
  ): (context: UseSkillContext) => boolean {
    return context => {
      const targets = selector(context)
      const values = targets.map(extractor)
      return operator(values)
    }
  }

  // 快捷方法：任意目标满足
  static any<T>(selector: TargetSelector<T>, extractor: ValueExtractor<T>) {
    return this.createCondition(selector, extractor, values => values.some(Boolean))
  }

  // 快捷方法：全部目标满足
  static all<T>(selector: TargetSelector<T>, extractor: ValueExtractor<T>) {
    return this.createCondition(selector, extractor, values => values.every(Boolean))
  }

  // 快捷方法：至少N个满足
  static atLeast<T, N extends number>(selector: TargetSelector<T>, extractor: ValueExtractor<T>, count: N) {
    return this.createCondition(selector, extractor, values => values.filter(Boolean).length >= count)
  }
}

// 常用目标选择器库
export const Selectors = {
  // 选择敌方出战精灵
  opponentActive: (context: UseSkillContext) => [context.actualTarget],

  // // 选择敌方存活精灵（包括后备）
  // opponentAlive: (context: UseSkillContext) => context.opponent.team.filter(pet => pet.isAlive),

  // 选择己方全体存活精灵
  allyAlive: (context: UseSkillContext) => context.player.team.filter(pet => pet.isAlive),

  // TODO: 选择天气环境
  // weather: (context: UseSkillContext) => [context.battleSystem.weather],

  // TODO 选择场地状态
  // fieldEffects: (context: UseSkillContext) => context.battleSystem.fieldEffects,

  // 选择当前使用的技能
  currentSkill: (context: UseSkillContext) => [context.skill],
}

// 常用属性提取器库
export const Extractors = {
  // 检查HP是否低于阈值
  hpBelow: (percent: number) => (target: Pet) => target.currentHp / target.maxHp! <= percent,

  // // 检查是否存在护盾
  // hasShield: (target: FieldEffect) => target.type === 'shield' && target.isActive,

  rageBelow: (value: number) => (target: Player) => target.currentRage <= value,
}

export enum EffectType {
  HEAL = 'HEAL',
  MARK_APPLY = 'MARK_APPLY',
  DAMAGE_MODIFIER = 'DAMAGE_MODIFIER',
  DAMAGE_THRESHOLD = 'DAMAGE_THRESHOLD',
}

interface BaseEffectConfig {
  phase: EffectTriggerPhase
  probability?: number
  condition?: (context: UseSkillContext) => boolean
  targetSelector: TargetSelector<Pet> // 使用现有目标选择器
}
// 修改效果类型定义
interface HealByPercent extends BaseEffectConfig {
  type: EffectType.HEAL
  mode: 'percent'
  value: number // 基于目标最大生命值的百分比（0-1）
}

interface HealByFixed extends BaseEffectConfig {
  type: EffectType.HEAL
  mode: 'fixed'
  value: number // 固定治疗数值
}

type HealConfig = HealByPercent | HealByFixed

interface BaseEffectConfig {
  id: string
  stacks?: number // 可叠加次数（可选）
}

// 伤害修正类型枚举
enum DamageModifierType {
  FLAT = 'flat', // 固定值加成
  PERCENTAGE = 'percent', // 百分比加成
  COMPOUND = 'compound',
}

// 固定值加成配置
interface FlatDamageModifierConfig extends BaseEffectConfig {
  type: EffectType.DAMAGE_MODIFIER
  modifierType: DamageModifierType.FLAT
  value: number // 固定值（如 +50）
}

// 百分比加成配置
interface PercentageDamageModifierConfig extends BaseEffectConfig {
  type: EffectType.DAMAGE_MODIFIER
  modifierType: DamageModifierType.PERCENTAGE
  value: number // 百分比系数（如 1.2 表示 120%）
}

// 复合加成使用示例
interface CompoundDamageModifierConfig extends BaseEffectConfig {
  type: EffectType.DAMAGE_MODIFIER
  modifierType: DamageModifierType.COMPOUND
  order: ['flat' | 'percent', 'flat' | 'percent'] // 计算顺序
  flatValue?: number
  percentValue?: number
}

interface DamageThresholdConfig extends BaseEffectConfig {
  type: EffectType.DAMAGE_THRESHOLD
  min?: number // 最小伤害（可选）
  max?: number // 最大伤害（可选）
}

// 联合类型配置
type DamageModifierConfig = FlatDamageModifierConfig | PercentageDamageModifierConfig | CompoundDamageModifierConfig

type EffectConfig = HealConfig | DamageModifierConfig | DamageThresholdConfig

export class EffectFactory {
  static create(config: EffectConfig): SkillEffect {
    return {
      phase: config.phase,
      apply: this.getApplyFunction(config),
      probability: config.probability,
      condition: config.condition,
    }
  }

  private static getApplyFunction(config: EffectConfig): (context: UseSkillContext) => void {
    switch (config.type) {
      case EffectType.HEAL:
        return context => {
          const targets = config.targetSelector(context)
          const healer = context.player.activePet

          targets.forEach(pet => {
            // 计算治疗量
            let healValue = 0
            switch (config.mode) {
              case 'percent':
                healValue = Math.floor(pet.maxHp! * config.value)
                break
              case 'fixed':
                healValue = config.value
                break
            }
            // 执行治疗
            if (healValue > 0) {
              context.battleSystem.performHeal(pet, healValue, healer)
            }
          })
        }

      case EffectType.DAMAGE_MODIFIER:
        return context => {
          switch (config.modifierType) {
            case DamageModifierType.PERCENTAGE:
              context.damageModified[0] += config.value
              break
            case DamageModifierType.FLAT:
              context.damageModified[1] += config.value
              break
            case DamageModifierType.COMPOUND:
              context.damageModified[0] += config.percentValue ?? 0
              context.damageModified[1] += config.flatValue ?? 0
              break
          }
        }
      case EffectType.DAMAGE_THRESHOLD:
        return context => {
          if (config.max) context.maxThreshold = config.max
          if (config.min) context.maxThreshold = config.min
        }

      default:
        throw new Error(`Unsupported effect type: ${config as never}`)
    }
  }
}
