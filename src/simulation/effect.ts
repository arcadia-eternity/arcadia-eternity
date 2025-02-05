import { Player } from './player'
import { StatOnBattle } from './const'
import { AddMarkContext, DamageContext, EffectContext, HealContext, RageContext, UseSkillContext } from './context'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'
import { Type } from './type'

// 统一效果触发阶段
export enum EffectTrigger {
  OnBattleStart = 'ON_BATTLE_START',
  PreDamage = 'PRE_DAMAGE',
  PostDamage = 'POST_DAMAGE',
  OnHit = 'ON_HIT',
  OnMiss = 'ON_MISS',
  OnCritPreDamage = 'ON_CRIT_PRE_DAMAGE',
  OnCritPostDamage = 'ON_CRIT_POST_DAMAGE',

  // 印记相关
  TurnStart = 'TURN_START',
  TurnEnd = 'TURN_END',
  BeforeAttack = 'BEFORE_ATTACK',
  AfterAttacked = 'AFTER_ATTACKED',

  OnStack = 'ON_STACK',

  // 通用
  OnHeal = 'ON_HEAL',
  OnSwitchIn = 'ON_SWITCH_IN',
  OnSwitchOut = 'ON_SWITCH_OUT',
  OnDefeat = 'ON_DEFEAT',
}

// 效果上下文

// 基础效果接口
export interface Effect {
  id: string
  trigger: EffectTrigger
  condition?: (ctx: EffectContext) => boolean
  apply: (ctx: EffectContext) => void
  meta?: {
    stackable?: boolean
    maxStacks?: number
    duration?: number
    persistent?: boolean
  }
}

// 效果容器接口
export interface EffectContainer {
  getEffects(trigger: EffectTrigger): Effect[]
}

// 效果应用器
export class EffectApplicator {
  static apply(container: EffectContainer, trigger: EffectTrigger, context: EffectContext) {
    const effects = container.getEffects(trigger)
    effects.forEach(effect => {
      try {
        if (!effect.condition || effect.condition(context)) {
          effect.apply(context)
        }
      } catch (error) {
        console.error(`Effect ${effect.id} failed:`, error)
      }
    })
  }
}
// 条件系统分为三个层级
// 修改选择器类型定义
export type TargetSelector<T> = (context: EffectContext) => T[]
export type ChainableTargetSelector<T> = TargetSelector<T> & {
  where: (predicate: (target: T, context: EffectContext) => boolean) => ChainableTargetSelector<T>
  and: (other: TargetSelector<T>) => ChainableTargetSelector<T>
  or: (other: TargetSelector<T>) => ChainableTargetSelector<T>
}
export type ValueExtractor<T, U> = (target: T) => U | U[]
export type ConditionOperator<U> = (values: U[]) => boolean // 判断逻辑
export type Operator<U> = (ctx: EffectContext, values: U[]) => void
export type ValueSource<T, U extends SelectorOpinion> =
  | DynamicValue<T, U> // 直接值或目标相关值
  | TargetSelector<T> // 选择器系统产生的值
  | ((ctx: EffectContext) => T) // 上下文相关值

// 重构链式选择器类（支持类型转换）
class ChainableSelector<T extends SelectorOpinion> {
  constructor(private selector: TargetSelector<T>) {}
  extract<U extends SelectorOpinion>(extractor: ValueExtractor<T, U>): ChainableSelector<U> {
    return new ChainableSelector<U>(context => [
      ...new Set(
        this.selector(context).flatMap(target => {
          const result = extractor(target)
          return Array.isArray(result) ? result : [result]
        }),
      ),
    ])
  }

  select(predicate: (target: T) => boolean): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => predicate(t))
    })
  }

  and(other: TargetSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      return prev.filter(t => otherResults.includes(t))
    })
  }

  or(other: TargetSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      return [...new Set([...prev, ...otherResults])]
    })
  }

  // 最终构建方法
  build(): TargetSelector<T> {
    return this.selector
  }

  apply(operator: Operator<T>) {
    return (ctx: EffectContext) => operator(ctx, this.selector(ctx))
  }
}

// 类型增强装饰器
function createChainable<T extends SelectorOpinion>(selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector)
}

export type SelectorOpinion = Player | Pet | Mark | Skill | UseSkillContext | StatOnBattle | number

// 基础选择器
export const BattleTarget: {
  self: ChainableSelector<Pet>
  foe: ChainableSelector<Pet>
  petOwners: ChainableSelector<Player>
  usingSkillContext: ChainableSelector<UseSkillContext>
} = {
  self: createChainable<Pet>((context: EffectContext) => [context.owner]),
  foe: createChainable<Pet>((context: EffectContext) => [(context.parent as UseSkillContext).actualTarget!]),
  petOwners: createChainable<Player>((context: EffectContext) => [context.owner.owner!]),
  usingSkillContext: createChainable<UseSkillContext>((context: EffectContext) => [context.parent as UseSkillContext]),
}

type BattleAttributesMap = {
  hp: (target: Pet) => number
  rage: (target: Player) => number
  owner: (target: Pet) => Player
  type: (target: Pet) => Type
  marks: (target: Pet) => Mark[]
  stats: (target: Pet) => StatOnBattle
  stack: (target: Mark) => number
  duration: (target: Mark) => number
  power: (target: UseSkillContext) => number
  priority: (target: UseSkillContext) => number
  activePet: (target: Player) => Pet
  skills: (target: Pet) => Skill[]
}

type DynamicBattleAttributesMap = {
  amplify: (value: number) => (target: number) => number
}

// BattleAttributes用于提取Selector得到的一组对象的某个值，将这个值的类型作为新的Selector
export const BattleAttributes: BattleAttributesMap = {
  hp: (target: Pet) => target.currentHp,
  rage: (target: Player) => target.currentRage,
  owner: (target: Pet) => target.owner!,
  type: (target: Pet) => target.type,
  marks: (target: Pet) => target.marks,
  stats: (target: Pet) => target.stat,
  stack: (target: Mark) => target.stacks,
  duration: (target: Mark) => target.duration,
  power: (target: UseSkillContext) => target.power,
  priority: (target: UseSkillContext) => target.skillPriority,
  activePet: (target: Player) => target.activePet,
  skills: (target: Pet) => target.skills,
}

export const DynamicBattleAttributes: DynamicBattleAttributesMap = {
  amplify: (value: number) => (target: number) => target * value,
}

export const BattleConditions = {
  // number
  up: (value: number) => (targets: number[]) => targets.some(target => target > value),
  down: (value: number) => (targets: number[]) => targets.some(target => target < value),
  equal: (value: number) => (targets: number[]) => targets.some(target => target == value),
  upEqual: (value: number) => (targets: number[]) => targets.some(target => target >= value),
  downEqual: (value: number) => (targets: number[]) => targets.some(target => target <= value),
  notEqual: (value: number) => (targets: number[]) => targets.some(target => target != value),
  between: (min: number, max: number) => (targets: number[]) => targets.some(target => target >= min && target <= max),

  // marks
  hasMark: (markid: string) => (marks: Mark[]) => marks.some(v => v.id == markid),
}

type DynamicValue<T, U extends SelectorOpinion> = T | ((target: U, context: EffectContext) => T)

function createDynamicOperator<T extends SelectorOpinion, U>(
  handler: (value: U | undefined, target: T, ctx: EffectContext) => void,
) {
  return (source: ValueSource<U, T>) => {
    return (ctx: EffectContext, targets: T[]) => {
      targets.forEach(target => {
        let finalValue: U | undefined

        if (typeof source === 'function') {
          try {
            // 处理选择器函数
            if (source.length === 1) {
              // Context函数
              finalValue = (source as (ctx: EffectContext) => U)(ctx)
            } else if (source.length === 2) {
              // Target+Context函数
              finalValue = (source as (target: T, ctx: EffectContext) => U)(target, ctx)
            } else {
              // 选择器类型
              const values = (source as TargetSelector<U>)(ctx)
              finalValue = values.length > 0 ? values[0] : undefined
            }
          } catch {
            finalValue = undefined
          }
        } else {
          finalValue = source as U
        }

        if (finalValue !== undefined) {
          handler(finalValue, target, ctx)
        }
      })
    }
  }
}

type NumberOperator<T extends SelectorOpinion> = (
  source: ValueSource<number, T> | TargetSelector<number>,
) => (ctx: EffectContext, targets: T[]) => void

// 操作符系统
export const BattleActions = {
  dealDamage: createDynamicOperator<Pet, number>((value, pet, ctx) => {
    if (typeof value === 'number') {
      pet.damage(new DamageContext(ctx, value, true))
    }
  }) as NumberOperator<Pet>,

  heal: createDynamicOperator<Pet, number>((value, pet, ctx) => {
    if (typeof value === 'number') {
      pet.heal(new HealContext(ctx, pet, value))
    }
  }) as NumberOperator<Pet>,

  addMark:
    <T extends Pet>(markFactory: (target: T, ctx: EffectContext) => Mark) =>
    (ctx: EffectContext, targets: T[]) => {
      targets.forEach(pet => {
        const mark = markFactory(pet, ctx)
        pet.addMark(new AddMarkContext(ctx, pet, mark))
      })
    },

  // 玩家操作
  addRage:
    <T extends Player>(amount: DynamicValue<number, T>) =>
    (ctx: EffectContext, targets: T[]) => {
      targets.forEach(player => {
        const finalAmount = typeof amount === 'function' ? amount(player, ctx) : amount
        player.addRage(new RageContext(ctx, player, 'effect', 'add', finalAmount))
      })
    },

  // 属性操作增强
  modifyStat:
    <T extends Pet, K extends keyof StatOnBattle>(stat: K, value: DynamicValue<number, T>) =>
    (ctx: EffectContext, targets: T[]) => {
      targets.forEach(pet => {
        const finalValue = typeof value === 'function' ? value(pet, ctx) : value
        pet.stat[stat] += finalValue
      })
    },

  // 上下文相关操作
  amplifyPower:
    (multiplier: DynamicValue<number, UseSkillContext>) => (ctx: EffectContext, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const finalMultiplier = typeof multiplier === 'function' ? multiplier(skillCtx, ctx) : multiplier
        skillCtx.power *= finalMultiplier
      })
    },
}

export function CreateCondition<T>(
  selector: TargetSelector<T>,
  conditioner: ConditionOperator<T>,
): (ctx: EffectContext) => boolean {
  return (ctx: EffectContext) => conditioner(selector(ctx))
}
