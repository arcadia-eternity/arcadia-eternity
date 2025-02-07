import { BattleSystem } from '../simulation/battleSystem'
import { OwnedEntity, StatOnBattle } from '../simulation/const'
import { EffectContext, UseSkillContext } from '../simulation/context'
import { Mark } from '../simulation/mark'
import { Pet } from '../simulation/pet'
import { Player } from '../simulation/player'
import { Skill } from '../simulation/skill'
import { Type } from '../simulation/type'
import { ValueExtractor, ConditionOperator, Operator, DynamicValue } from './effectBuilder'

// 条件系统分为三个层级
// 修改选择器类型定义

export type TargetSelector<T> = (context: EffectContext) => T[]
export type ValueSource<T extends SelectorOpinion, U extends SelectorOpinion> =
  | DynamicValue<T, U> // 直接值或目标相关值
  | TargetSelector<T> // 选择器系统产生的值
  | ChainableSelector<T> // 链式选择器
  | ((ctx: EffectContext) => T[]) // 上下文相关值

// 重构链式选择器类（支持类型转换）
export class ChainableSelector<T extends SelectorOpinion> {
  constructor(private selector: TargetSelector<T>) {}

  [Symbol.toPrimitive](context: EffectContext): T[] {
    return this.selector(context)
  }

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
      return this.mapNumber(v => Math.floor(v * valueOrSelector))
    }
    return this.combine(valueOrSelector, (a, b) => a * b)
  }

  // 除法运算
  divide(value: number): ChainableSelector<number> {
    return this.mapNumber(v => Math.floor(v / value))
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
  self: createChainable<Pet>((context: EffectContext) => {
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  foe: createChainable<Pet>((context: EffectContext) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.actualTarget!]
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!).activePet]
    //TODO: error with use owners with global marks
    return []
  }),
  petOwners: createChainable<Player>((context: EffectContext) => {
    if (context.source.owner instanceof Pet) return [context.source.owner.owner!]
    //TODO: error with use owners with global marks
    return []
  }),
  usingSkillContext: createChainable<UseSkillContext>((context: EffectContext) => {
    if (context.parent instanceof UseSkillContext) return [context.parent]
    //TODO: error with use get context with non-Useskill context
    return []
  }),
}
type BattleAttributesMap = {
  hp: (target: Pet) => number
  maxhp: (target: Pet) => number
  rage: (target: Player) => number
  owner: (target: OwnedEntity) => BattleSystem | Player | Pet | Mark | Skill | null
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
  maxhp: (target: Pet) => target.maxHp!,
  rage: (target: Player) => target.currentRage,
  owner: (target: OwnedEntity) => target.owner!,
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
