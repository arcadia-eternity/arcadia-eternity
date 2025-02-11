import { BattleSystem } from '@core/battleSystem'
import { OwnedEntity, StatOnBattle } from '@core/const'
import { EffectContext, UseSkillContext } from '@core/context'
import { Mark } from '@core/mark'
import { Pet } from '@core/pet'
import { Player } from '@core/player'
import { Skill } from '@core/skill'
import { Element } from '@core/element'
import { ValueExtractor, ConditionOperator, Operator } from './effectBuilder'
import { EffectTrigger } from '@core/effect'
import { Primitive } from 'zod'

// 条件系统分为三个层级
// 修改选择器类型定义

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]
export type ValueSource<T extends SelectorOpinion> =
  | T
  | TargetSelector<T> // 选择器系统产生的值
  | ChainableSelector<T> // 链式选择器

// 重构链式选择器类（支持类型转换）
export class ChainableSelector<T extends SelectorOpinion> {
  constructor(private selector: TargetSelector<T>) {}

  [Symbol.toPrimitive](context: EffectContext<EffectTrigger>): T[] {
    return this.selector(context)
  }

  //选择一组对象的某一个参数
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

  //对结果进行筛选
  where(predicate: (target: T) => boolean): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => predicate(t))
    })
  }

  //在保持当前结果类型的同时，对参数进行筛选
  whereAttr<U>(extractor: ValueExtractor<T, U>, condition: ConditionOperator<U>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => {
        const value = extractor(t)
        const values = Array.isArray(value) ? value : [value]
        return condition(context, values)
      })
    })
  }

  //两个同类型的结果取交集
  and(other: TargetSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      return prev.filter(t => otherResults.includes(t))
    })
  }

  //两个同类型的结果取并集
  or(other: TargetSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      return [...new Set([...prev, ...otherResults])]
    })
  }

  //对所有的结果进行求和，得到唯一的参数
  sum(this: ChainableSelector<number>): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const values = this.selector(context)
      return [values.reduce((acc, cur) => acc + cur, 0)]
    })
  }

  //加一个固定数，或者加一个来源的数。如果来源选择了多个数，则会加上来源的每一个数。
  add(value: number): ChainableSelector<number>
  add(selector: ChainableSelector<number>): ChainableSelector<number>
  add(valueOrSelector: number | ChainableSelector<number>): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => v + valueOrSelector)
    }
    return this.combine(valueOrSelector, (a, b) => a + b)
  }

  // 乘一个固定数，或者乘一个来源的数。如果来源选择了多个数，则会乘上来源的每一个数。
  multiply(value: number): ChainableSelector<number>
  multiply(selector: ChainableSelector<number>): ChainableSelector<number>
  multiply(valueOrSelector: number | ChainableSelector<number>): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => Math.floor(v * valueOrSelector))
    }
    return this.combine(valueOrSelector, (a, b) => a * b)
  }

  // 除以一个固定数，或者除以一个来源的数。如果来源选择了多个数，则会除以上来源的每一个数。
  divide(value: number): ChainableSelector<number>
  divide(selector: ChainableSelector<number>): ChainableSelector<number>
  divide(valueOrSelector: number | ChainableSelector<number>): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => Math.floor(v / valueOrSelector))
    }
    return this.combine(valueOrSelector, (a, b) => a / b)
  }

  randomPick(count: number): ChainableSelector<T> {
    return new ChainableSelector(ctx => {
      const list = this.selector(ctx)
      return ctx.battle.shuffle(list).slice(0, count) // 使用随机洗牌
    })
  }

  /**
   * 按百分比概率选取每个目标
   * @param percent 命中概率(0-100)
   **/
  randomSample(percent: number): ChainableSelector<T> {
    return new ChainableSelector(ctx => {
      return this.selector(ctx).filter(() => ctx.battle.randomInt(1, 100) <= percent)
    })
  }

  /**
   * 对目标列表乱序后返回
   **/
  shuffled(): ChainableSelector<T> {
    return new ChainableSelector(ctx => ctx.battle.shuffle(this.selector(ctx)))
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
    return (ctx: EffectContext<EffectTrigger>) => conditioner(ctx, this.selector(ctx))
  }

  apply(operator: Operator<T>) {
    return (ctx: EffectContext<EffectTrigger>) => operator(ctx, this.selector(ctx))
  }
}
// 类型增强装饰器
function createChainable<T extends SelectorOpinion>(selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector)
}

export type SelectorOpinion = Player | Pet | Mark | Skill | UseSkillContext | StatOnBattle | Primitive
// 基础选择器
export const BaseSelector: {
  self: ChainableSelector<Pet>
  foe: ChainableSelector<Pet>
  petOwners: ChainableSelector<Player>
  usingSkillContext: ChainableSelector<UseSkillContext>
  mark: ChainableSelector<Mark>
} = {
  self: createChainable<Pet>((context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  foe: createChainable<Pet>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.actualTarget!]
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!).activePet]
    //TODO: error with use owners with global marks
    return []
  }),
  petOwners: createChainable<Player>((context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return [context.source.owner.owner!]
    //TODO: error with use owners with global marks
    return []
  }),
  usingSkillContext: createChainable<UseSkillContext>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent]
    //TODO: error with use get context with non-Useskill context
    return []
  }),
  mark: createChainable<Mark>((context: EffectContext<EffectTrigger>) => {
    if (context.source instanceof Mark) return [context.source]
    //TODO: error with use get context with non-MarkEffect context
    return []
  }),
}

type ExtractorMap = {
  hp: (target: Pet) => number
  maxhp: (target: Pet) => number
  rage: (target: Player) => number
  owner: (target: OwnedEntity) => BattleSystem | Player | Pet | Mark | Skill | null
  type: (target: Pet) => Element
  marks: (target: Pet) => Mark[]
  stats: (target: Pet) => StatOnBattle
  stack: (target: Mark) => number
  duration: (target: Mark) => number
  power: (target: UseSkillContext) => number
  priority: (target: UseSkillContext) => number
  activePet: (target: Player) => Pet
  skills: (target: Pet) => Skill[]
  id: (mark: Mark) => string
  tags: (mark: Mark) => string[]
}

// BattleAttributes用于提取Selector得到的一组对象的某个值，将这个值的类型作为新的Selector
export const Extractor: ExtractorMap = {
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
  id: (mark: Mark) => mark.id,
  tags: (mark: Mark) => mark.tags,
}

export type Path<T, P extends string> = P extends `${infer HeadPath}[]${infer Tail}`
  ? Path<T, HeadPath> extends Array<infer U>
    ? Path<U, Tail> extends infer R
      ? R extends never
        ? never
        : R[]
      : never
    : never
  : // 处理以 `.` 开头的路径（兼容分割后的空字符）
    P extends `.${infer Rest}`
    ? Path<T, Rest>
    : // 处理普通属性访问（如 `owner.activePet`）
      P extends `${infer Head}.${infer Tail}`
      ? Head extends keyof T
        ? T[Head] extends object | Array<unknown> | null | undefined
          ? Path<NonNullable<T[Head]>, Tail> // 递归处理非空属性
          : never
        : never
      : // 处理直接属性（如 `duration`）
        P extends keyof T
        ? T[P]
        : never

export function createExtractor<T, P extends string>(path: P): (target: T) => Path<T, P> {
  const keys = path.split(/\.|\[\]/).filter(Boolean)
  return (target: T) => {
    let value: unknown = target
    for (const key of keys) {
      if (Array.isArray(value)) {
        value = value.flatMap(v => v[key as keyof typeof v])
      } else {
        value = value?.[key as keyof typeof value]
      }
    }
    return value as Path<T, P>
  }
}

export function GetValueFromSource<T extends SelectorOpinion>(
  ctx: EffectContext<EffectTrigger>,
  source: ValueSource<T>,
): T[] {
  if (source instanceof ChainableSelector) return source.build()(ctx)
  if (typeof source == 'function') return source(ctx)
  return [source]
}
