import { BattleSystem } from '@core/battleSystem'
import { OwnedEntity, StatOnBattle, StatTypeOnBattle } from '@core/const'
import { EffectContext, UseSkillContext } from '@core/context'
import { Mark } from '@core/mark'
import { Pet } from '@core/pet'
import { Player } from '@core/player'
import { Skill } from '@core/skill'
import { Element } from '@core/element'
import { ValueExtractor, ConditionOperator, Operator } from './effectBuilder'
import { EffectTrigger } from '@core/effect'

// 条件系统分为三个层级
// 修改选择器类型定义

export type TargetSelector<T> = (context: EffectContext<EffectTrigger>) => T[]
export type ValueSource<T extends SelectorOpinion> =
  | T
  | TargetSelector<T> // 选择器系统产生的值
  | ChainableSelector<T> // 链式选择器

// 重构链式选择器类（支持类型转换）

export class ChainableSelector<T extends SelectorOpinion> {
  public readonly _type!: T
  constructor(private selector: TargetSelector<T>) {}

  [Symbol.toPrimitive](context: EffectContext<EffectTrigger>): T[] {
    return this.selector(context)
  }

  //选择一组对象的某一个参数
  select<U extends SelectorOpinion>(extractor: ValueExtractor<T, U>): ChainableSelector<U> {
    return new ChainableSelector<U>(context =>
      this.selector(context).map(t => {
        // 运行时类型检查
        if (typeof extractor !== 'function') {
          throw new Error(`提取器必须为函数，实际类型：${typeof extractor}`)
        }
        const value = extractor(t)
        return value as U
      }),
    )
  }

  //对结果进行筛选
  where(predicate: ConditionOperator<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => predicate(context, [t]))
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
  and(other: TargetSelector<T> | ChainableSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      let otherResults
      if (other instanceof ChainableSelector) otherResults = other.build()(context)
      else otherResults = other(context)
      return prev.filter(t => otherResults.includes(t))
    })
  }

  //两个同类型的结果取并集,相同的值会省略
  or(other: TargetSelector<T>, duplicate: boolean): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      if (!duplicate) return [...new Set([...prev, ...otherResults])]
      return [...prev, ...otherResults]
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

export type SelectorOpinion =
  | Pet
  | Mark
  | Player
  | Skill
  | StatOnBattle
  | UseSkillContext
  | BattleSystem
  | number
  | StatTypeOnBattle
  | string
  | boolean
  | null
  | Mark[]
  | Skill[]
  | string[]
  | Element
  | OwnedEntity

// 基础选择器
export const BaseSelector: {
  self: ChainableSelector<Pet>
  foe: ChainableSelector<Pet>
  petOwners: ChainableSelector<Player>
  foeOwners: ChainableSelector<Player>
  usingSkillContext: ChainableSelector<UseSkillContext>
  mark: ChainableSelector<Mark>
  selfMarks: ChainableSelector<Mark>
  foeMarks: ChainableSelector<Mark>
} = {
  self: createChainable<Pet>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.pet]
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
    if (context.parent instanceof UseSkillContext) return [context.parent.pet.owner!]
    if (context.source.owner instanceof Pet) return [context.source.owner.owner!]
    //TODO: error with use owners with global marks
    return []
  }),
  foeOwners: createChainable<Player>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.actualTarget!.owner!]
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!)]
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
  selfMarks: createChainable<Mark>((context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return context.source.owner.marks
    //TODO: error with use owners with global marks
    return []
  }),
  foeMarks: createChainable<Mark>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return context.parent.actualTarget!.marks
    if (context.source.owner instanceof Pet)
      return context.battle.getOpponent(context.source.owner.owner!).activePet.marks
    //TODO: error with use owners with global marks
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

// Extractor用于提取Selector得到的一组对象的某个值，将这个值的类型作为新的Selector
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

export function isPet(target: SelectorOpinion): target is Pet {
  return target instanceof Pet
}

export function isPlayer(target: SelectorOpinion): target is Player {
  return target instanceof Player
}

export function isMark(target: SelectorOpinion): target is Mark {
  return target instanceof Mark
}

export function isSkill(target: SelectorOpinion): target is Skill {
  return target instanceof Skill
}

export function isUseSkillContext(target: SelectorOpinion): target is UseSkillContext {
  return target instanceof UseSkillContext
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isOwnedEntity(obj: any): obj is OwnedEntity {
  return (
    // 检查是否存在owner属性（不验证类型）
    'owner' in obj &&
    // 检查是否存在setOwner方法
    typeof obj.setOwner === 'function' &&
    // 可选：进一步验证owner类型（需要递归类型检查）
    (obj.owner === null ||
      obj.owner instanceof BattleSystem ||
      obj.owner instanceof Player ||
      obj.owner instanceof Pet ||
      obj.owner instanceof Mark ||
      obj.owner instanceof Skill)
  )
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
        : never & SelectorOpinion

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
    if (!isValidSelectorOpinion(value)) {
      throw new Error(`路径${path}解析到无效类型: ${typeof value}`)
    }

    return value as Path<T, P>
  }
}

function isValidSelectorOpinion(value: unknown): value is SelectorOpinion {
  const validTypes = [
    Pet,
    Mark,
    Player,
    Skill,
    UseSkillContext,
    BattleSystem,
    Number,
    String,
    Boolean,
    Array,
    Object,
    null,
  ]
  return (
    validTypes.some(
      type => (typeof type === 'function' && value instanceof type) || (value === null && type === null),
    ) || isStatOnBattle(value)
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isStatOnBattle(value: any): value is StatOnBattle {
  return value && typeof value.attack === 'number' && typeof value.defense === 'number'
}

export function GetValueFromSource<T extends SelectorOpinion>(
  ctx: EffectContext<EffectTrigger>,
  source: ValueSource<T>,
): T[] {
  if (source instanceof ChainableSelector) return source.build()(ctx)
  if (typeof source == 'function') return source(ctx)
  return [source]
}
