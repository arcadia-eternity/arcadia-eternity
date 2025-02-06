import { Player } from './player'
import { Prototype, StatOnBattle } from './const'
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
export interface Effect extends Prototype {
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
export type ValueExtractor<T, U> = (target: T) => U | U[]
export type ConditionOperator<U> = (ctx: EffectContext, values: U[]) => boolean // 判断逻辑
export type Operator<U> = (ctx: EffectContext, values: U[]) => void
export type ValueSource<T, U extends SelectorOpinion> =
  | DynamicValue<T, U> // 直接值或目标相关值
  | TargetSelector<T> // 选择器系统产生的值
  | ((ctx: EffectContext) => T) // 上下文相关值

// 重构链式选择器类（支持类型转换）
class ChainableSelector<T extends SelectorOpinion> {
  constructor(private selector: TargetSelector<T>) {}
  select<U extends SelectorOpinion>(extractor: ValueExtractor<T, U>): ChainableSelector<U> {
    return new ChainableSelector<U>(context => [
      ...new Set(
        this.selector(context).flatMap(target => {
          const result = extractor(target)
          return Array.isArray(result) ? result : [result]
        }),
      ),
    ])
  }

  where(predicate: (target: T) => boolean): ChainableSelector<T> {
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

  sum(this: ChainableSelector<number>): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const values = this.selector(context)
      return [values.reduce((acc, cur) => acc + cur, 0)]
    })
  }

  add(value: number): ChainableSelector<number>
  add(selector: ChainableSelector<number>): ChainableSelector<number>
  add(valueOrSelector: number | ChainableSelector<number>): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => v + valueOrSelector)
    }
    return this.combine(valueOrSelector, (a, b) => a + b)
  }

  // 函数重载声明
  multiply(value: number): ChainableSelector<number>
  multiply(selector: ChainableSelector<number>): ChainableSelector<number>
  multiply(valueOrSelector: number | ChainableSelector<number>): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => v * valueOrSelector)
    }
    return this.combine(valueOrSelector, (a, b) => a * b)
  }

  // 除法运算
  divide(value: number): ChainableSelector<number> {
    return this.mapNumber(v => v / value)
  }

  // 最大值限制
  clampMax(max: number): ChainableSelector<number> {
    return this.mapNumber(v => Math.min(v, max))
  }

  // 最小值限制
  clampMin(min: number): ChainableSelector<number> {
    return this.mapNumber(v => Math.max(v, min))
  }

  // 公共数值处理方法
  private mapNumber(fn: (v: number) => number): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const values = this.selector(context)
      return values.map(v => {
        const num = Number(v)
        return isNaN(num) ? 0 : fn(num)
      })
    })
  }

  private combine(
    other: ChainableSelector<number>,
    operation: (a: number, b: number) => number,
  ): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const valuesA = this.selector(context) as number[]
      const valuesB = other.selector(context) as number[]
      return valuesA.map((a, i) => operation(a, valuesB[i] ?? 0))
    })
  }

  // 最终构建方法
  build(): TargetSelector<T> {
    return this.selector
  }

  condition(conditioner: ConditionOperator<T>) {
    return (ctx: EffectContext) => conditioner(ctx, this.selector(ctx))
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

export const BattleConditions = {
  // number
  up: (value: number) => (_: EffectContext, targets: number[]) => targets.some(target => target > value),
  down: (value: number) => (_: EffectContext, targets: number[]) => targets.some(target => target < value),
  equal: (value: number) => (_: EffectContext, targets: number[]) => targets.some(target => target == value),
  upEqual: (value: number) => (_: EffectContext, targets: number[]) => targets.some(target => target >= value),
  downEqual: (value: number) => (_: EffectContext, targets: number[]) => targets.some(target => target <= value),
  notEqual: (value: number) => (_: EffectContext, targets: number[]) => targets.some(target => target != value),
  between: (min: number, max: number) => (_: EffectContext, targets: number[]) =>
    targets.some(target => target >= min && target <= max),

  // marks
  hasMark: (markid: string) => (marks: Mark[]) => marks.some(v => v.id == markid),
}

export function createDynamicCondition<T extends SelectorOpinion, U>(
  selector: ChainableSelector<T>,
  extractor: ValueExtractor<T, U>,
  operator: ConditionOperator<U>,
): (ctx: EffectContext) => boolean {
  return (ctx: EffectContext) => {
    try {
      const targets = selector.build()(ctx)
      const values = targets.flatMap(t => {
        const extracted = extractor(t)
        return Array.isArray(extracted) ? extracted : [extracted]
      })
      return operator(ctx, values)
    } catch (error) {
      console.error('Condition evaluation failed:', error)
      return false
    }
  }
}

export const DynamicConditions = {
  compare:
    <T extends number>(operator: '>' | '<' | '>=' | '<=' | '==') =>
    (values: T[], ctx: EffectContext, compareValue: T): boolean => {
      return values.some(value => {
        switch (operator) {
          case '>':
            return value > compareValue
          case '<':
            return value < compareValue
          case '>=':
            return value >= compareValue
          case '<=':
            return value <= compareValue
          case '==':
            return value === compareValue
          default:
            return false
        }
      })
    },

  hasId:
    <T extends Prototype>(id: string) =>
    (values: T[]): boolean => {
      return values.some(v => v.id === id)
    },

  any:
    <T>(...ops: ConditionOperator<T>[]): ConditionOperator<T> =>
    (ctx: EffectContext, values: T[]) =>
      ops.some(op => op(ctx, values)),

  all:
    <T>(...ops: ConditionOperator<T>[]): ConditionOperator<T> =>
    (ctx: EffectContext, values: T[]) =>
      ops.every(op => op(ctx, values)),

  probability:
    (percent: number): ConditionOperator<unknown> =>
    (ctx: EffectContext) =>
      ctx.battle.random() < percent / 100,

  turnCount:
    (predicate: (n: number) => boolean): ConditionOperator<unknown> =>
    (ctx: EffectContext) =>
      predicate(ctx.battle.currentTurn),
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

// 操作符系统
export const BattleActions = {
  dealDamage: createDynamicOperator<Pet, number>((value, pet, ctx) => {
    if (typeof value === 'number') {
      pet.damage(new DamageContext(ctx, value, true))
    }
  }),

  heal: createDynamicOperator<Pet, number>((value, pet, ctx) => {
    if (typeof value === 'number') {
      pet.heal(new HealContext(ctx, pet, value))
    }
  }),

  addMark:
    <T extends Pet>(markFactory: (target: T, ctx: EffectContext) => Mark) =>
    (ctx: EffectContext, targets: T[]) => {
      targets.forEach(pet => {
        const mark = markFactory(pet, ctx)
        pet.addMark(new AddMarkContext(ctx, pet, mark))
      })
    },

  // 玩家操作
  addRage: createDynamicOperator<Player, number>((value, player, ctx) => {
    if (typeof value === 'number') {
      player.addRage(new RageContext(ctx, player, 'effect', 'add', value))
    }
  }),

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
