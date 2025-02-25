import {
  Battle,
  DamageContext,
  EffectContext,
  MarkInstance,
  Pet,
  Player,
  UseSkillContext,
  SkillInstance,
} from '@test-battle/battle'
import type { OwnedEntity, Prototype } from '@test-battle/battle/entity'
import { EffectTrigger, Element, type StatOnBattle, type StatTypeOnBattle } from '@test-battle/const'
import type {
  Action,
  Condition,
  Evaluator,
  Operator,
  TargetSelector,
  ValueExtractor,
  ValueSource,
} from './effectBuilder'

export type PropertyRef<T, V> = {
  get: () => V
  set: (value: V) => void
  target: T // 保留原对象引用
}

export class ChainableSelector<T extends SelectorOpinion> {
  public readonly _type!: T
  constructor(private selector: TargetSelector<T>) {
    //TODO: 运行时检测当前type
    // const sample = this.selector({} as EffectContext<EffectTrigger>)[0]
    // this.valueType = typeof sample === 'object' ? sample?.constructor?.name || 'object' : typeof sample
  }

  [Symbol.toPrimitive](context: EffectContext<EffectTrigger>): T[] {
    return this.selector(context)
  }

  asRef<V>(extractor: (t: T) => V): ChainableSelector<PropertyRef<T, V>> {
    return new ChainableSelector(context =>
      this.selector(context).map(target => ({
        target,
        get: () => extractor(target),
        set: (value: V) => {
          //TODO
        },
      })),
    )
  }

  //选择一组对象的某一个参数
  select<U extends SelectorOpinion>(extractor: ValueExtractor<T, U>): ChainableSelector<U> {
    return new ChainableSelector<U>(context =>
      this.selector(context).map(t => {
        const value = extractor(t)
        return value as U
      }),
    )
  }

  //对结果进行筛选
  where(predicate: Evaluator<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => predicate(context, [t]))
    })
  }

  //在保持当前结果类型的同时，对参数进行筛选
  whereAttr<U>(extractor: ValueExtractor<T, U>, condition: Evaluator<U>): ChainableSelector<T> {
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
    return new ChainableSelector(context => {
      const list = this.selector(context)
      return context.battle.shuffle(list).slice(0, count) // 使用随机洗牌
    })
  }

  length(): ChainableSelector<number> {
    return new ChainableSelector(context => {
      const list = this.selector(context)
      return [list.length]
    })
  }

  /**
   * 按百分比概率选取每个目标
   * @param percent 命中概率(0-100)
   **/
  randomSample(percent: number): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(() => context.battle.randomInt(1, 100) <= percent)
    })
  }

  /**
   * 对目标列表乱序后返回
   **/
  shuffled(): ChainableSelector<T> {
    return new ChainableSelector(context => context.battle.shuffle(this.selector(context)))
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

  condition(conditioner: Evaluator<T>): Condition {
    return (context: EffectContext<EffectTrigger>) => conditioner(context, this.selector(context))
  }

  apply(operator: Operator<T>): Action {
    return (context: EffectContext<EffectTrigger>) => operator(context, this.selector(context))
  }

  isNumberType(): this is ChainableSelector<number> {
    return typeof this._type === 'number'
  }
}
// 类型增强装饰器
function createChainable<T extends SelectorOpinion>(selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector)
}

export type SelectorOpinion =
  | Pet
  | MarkInstance
  | Player
  | StatOnBattle
  | UseSkillContext
  | DamageContext
  | Battle
  | number
  | StatTypeOnBattle
  | string
  | boolean
  | null
  | MarkInstance
  | MarkInstance[]
  | SkillInstance
  | SkillInstance[]
  | string
  | string[]
  | Element
  | OwnedEntity
  | Prototype
  | PropertyRef<any, any> //TODO

// 基础选择器
export const BaseSelector: {
  target: ChainableSelector<Pet>
  self: ChainableSelector<Pet>
  foe: ChainableSelector<Pet>
  petOwners: ChainableSelector<Player>
  foeOwners: ChainableSelector<Player>
  usingSkillContext: ChainableSelector<UseSkillContext>
  damageContext: ChainableSelector<DamageContext>
  mark: ChainableSelector<MarkInstance>
  selfMarks: ChainableSelector<MarkInstance>
  foeMarks: ChainableSelector<MarkInstance>
} = {
  //选择目标，在使用技能的场景下，为技能实际指向的目标，在印记的场景下指向印记的所有者。
  target: createChainable<Pet>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext)
      return context.parent.actualTarget ? [context.parent.actualTarget] : []
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  //在使用技能的场景和印记的场景都指向拥有者自身。
  self: createChainable<Pet>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.pet]
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  //在使用技能的场景，指向技能拥有者的敌方玩家的当前首发，在印记的场景指向印记所有者的敌方玩家的当前首发。
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
  damageContext: createChainable<DamageContext>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof DamageContext) return [context.parent]
    //TODO: error with use get context with non-Damage context
    return []
  }),
  mark: createChainable<MarkInstance>((context: EffectContext<EffectTrigger>) => {
    if (context.source instanceof MarkInstance) return [context.source]
    //TODO: error with use get context with non-MarkEffect context
    return []
  }),
  selfMarks: createChainable<MarkInstance>((context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return context.source.owner.marks
    //TODO: error with use owners with global marks
    return []
  }),
  foeMarks: createChainable<MarkInstance>((context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return context.parent.actualTarget!.marks
    if (context.source.owner instanceof Pet)
      return context.battle.getOpponent(context.source.owner.owner!).activePet.marks
    //TODO: error with use owners with global marks
    return []
  }),
}

export function isPet(target: SelectorOpinion): target is Pet {
  return target instanceof Pet
}

export function isPlayer(target: SelectorOpinion): target is Player {
  return target instanceof Player
}

export function isMark(target: SelectorOpinion): target is MarkInstance {
  return target instanceof MarkInstance
}

export function isSkill(target: SelectorOpinion): target is SkillInstance {
  return target instanceof SkillInstance
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
      obj.owner instanceof Battle ||
      obj.owner instanceof Player ||
      obj.owner instanceof Pet ||
      obj.owner instanceof MarkInstance ||
      obj.owner instanceof SkillInstance)
  )
}

export function GetValueFromSource<T extends SelectorOpinion>(
  context: EffectContext<EffectTrigger>,
  source: ValueSource<T>,
): T[] {
  if (source instanceof ChainableSelector) return source.build()(context)
  if (typeof source == 'function') return source(context) //TargetSelector
  if (isPropertyRef(source)) {
    return [source.get()] // 返回当前值
  }
  return [source]
}

function isPropertyRef(obj: any): obj is PropertyRef<any, any> {
  return obj && typeof obj.get === 'function' && typeof obj.set === 'function'
}
