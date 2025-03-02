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
import type { CanOwnedEntity, Instance, OwnedEntity, Prototype } from '@test-battle/battle/entity'
import {
  AttackTargetOpinion,
  Category,
  EffectTrigger,
  Element,
  Gender,
  Nature,
  type baseMarkId,
  type baseSkillId,
  type markId,
  type petId,
  type playerId,
  type skillId,
  type speciesId,
  type StatOnBattle,
  type StatTypeOnBattle,
} from '@test-battle/const'
import type { Action, Condition, Evaluator, Operator, TargetSelector, ValueExtractor } from './effectBuilder'
import { createExtractor, type PathExtractor } from './extractor'
import { RuntimeTypeChecker } from './runtime-type-checker'

export type PropertyRef<T, V> = {
  get: () => V
  set: (value: V) => void
  target: T // 保留原对象引用
}

export class ChainableSelector<T> {
  private readonly _isNumberType: boolean
  constructor(
    public selector: TargetSelector<T>,
    public type: string,
  ) {
    this._isNumberType = RuntimeTypeChecker.isNumberType(type)
  }

  [Symbol.toPrimitive](context: EffectContext<EffectTrigger>): T[] {
    return this.selector(context)
  }

  selectProp<K extends keyof NonNullable<T>>(
    prop: K,
  ): T extends object ? ChainableSelector<PropertyRef<NonNullable<T>, NonNullable<T>[K]>> : never {
    const newTypePath = this.getPropTypePath(prop as string)
    return new ChainableSelector(
      context =>
        this.selector(context)
          .filter((target): target is NonNullable<T> => !!target)
          .map(target => ({
            target: target as NonNullable<T>,
            get: () => (target as NonNullable<T>)[prop],
            set: (value: NonNullable<T>[K]) => {
              ;(target as NonNullable<T>)[prop] = value
            },
          })),
      newTypePath,
    ) as T extends object ? ChainableSelector<PropertyRef<NonNullable<T>, NonNullable<T>[K]>> : never
  }

  selectPath<P extends string>(path: P) {
    if (process.env.NODE_ENV !== 'production') {
      if (!/^[\w\[\].]+$/.test(path)) {
        throw new Error(`Invalid path format: ${path}`)
      }
    }
    // 执行运行时验证
    if (!RuntimeTypeChecker.validatePath(this.type, path)) {
      const expected = RuntimeTypeChecker.getExpectedType(this.type, path)
      throw new Error(`[TypeError] Path '${path}' not found on ${this.type}\n` + `Expected type: ${expected}`)
    }

    // 计算新类型路径（例如：Pet.marks[] -> MarkInstance[]）
    const newType = RuntimeTypeChecker.getExpectedType(this.type, path).replace(/\[\]$/, '[]') // 保持数组标记

    return new ChainableSelector(context => this.selector(context).flatMap(createExtractor(path)), newType)
  }

  //选择一组对象的某一个参数
  select<U>(extractor: PathExtractor<T, U>): ChainableSelector<U>
  select<U>(extractor: ValueExtractor<T, U>, extractorPath?: string): ChainableSelector<U>
  select<U>(extractor: PathExtractor<T, U> | ValueExtractor<T, U>, extractorPath?: string): ChainableSelector<U> {
    if (typeof extractor !== 'function') {
      return this.createExtractedSelector(extractor)
    }

    // 开发环境下的路径验证
    if (process.env.NODE_ENV !== 'production' && extractorPath) {
      const fullPath = `${this.type}.${extractorPath}`

      if (!RuntimeTypeChecker.validatePath(this.type, extractorPath)) {
        throw new Error(`[TypeCheck] Invalid path: ${fullPath}`)
      }

      // 获取新类型路径（例如从 Pet 提取 marks -> MarkInstance[]）
      const newType = RuntimeTypeChecker.getExpectedType(this.type, extractorPath).replace(/\[\]$/, '[]') // 标准化数组表示

      return new ChainableSelector<U>(context => this.selector(context).map(extractor), newType)
    }

    // 生产环境跳过验证
    return new ChainableSelector<U>(
      context => this.selector(context).map(extractor),
      'any', // 生产环境类型追踪可关闭
    )
  }

  private createExtractedSelector<U>(extractor: PathExtractor<T, U>): ChainableSelector<U> {
    // 自动构建新类型路径
    const newTypePath = `${this.type}.${extractor.path}`
      .replace(/\.\[\]/g, '[]') // 处理数组语法
      .replace(/\[\]\./g, '[]')

    // 开发环境类型校验
    if (process.env.NODE_ENV !== 'production') {
      if (!RuntimeTypeChecker.validatePath(this.type, extractor.path)) {
        throw new Error(`[类型错误] 路径 ${extractor.path} 在 ${this.type} 中不存在`)
      }
    }

    return new ChainableSelector<U>(context => this.selector(context).map(extractor.extract), newTypePath)
  }

  //对结果进行筛选
  where(predicate: Evaluator<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => predicate(context, [t]))
    }, this.type)
  }

  whereAttr<U extends SelectorOpinion>(extractor: PathExtractor<T, U>, condition: Evaluator<U>): ChainableSelector<T>
  // 使用函数式提取器 + 路径的签名
  whereAttr<U extends SelectorOpinion>(
    extractor: ValueExtractor<T, U>,
    path: string,
    condition: Evaluator<U>,
  ): ChainableSelector<T>
  //在保持当前结果类型的同时，对参数进行筛选
  whereAttr<U extends SelectorOpinion>(
    extractor: PathExtractor<T, U> | ValueExtractor<T, U>,
    pathOrCondition: string | Evaluator<U>,
    condition?: Evaluator<U>,
  ): ChainableSelector<T> {
    // 参数类型解析
    let actualExtractor: ValueExtractor<T, U>
    let actualPath: string
    let actualCondition: Evaluator<U>

    if (typeof pathOrCondition === 'string') {
      // 处理函数式提取器 + 路径的情况
      actualExtractor = extractor as ValueExtractor<T, U>
      actualPath = pathOrCondition
      actualCondition = condition!

      // 开发环境路径校验
      if (process.env.NODE_ENV !== 'production') {
        if (!RuntimeTypeChecker.validatePath(this.type, actualPath)) {
          throw new Error(`[路径校验失败] 路径 "${actualPath}" 在类型 "${this.type}" 中无效\n`)
        }
      }
    } else {
      const chainableExtractor = extractor as PathExtractor<T, U>
      actualExtractor = chainableExtractor.extract
      actualPath = chainableExtractor.path
      actualCondition = pathOrCondition as Evaluator<U>
    }

    return new ChainableSelector(context => {
      return this.selector(context).filter(target => {
        const rawValue = actualExtractor(target)
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]

        return actualCondition(context, values as U[])
      })
    }, this.type)
  }

  //两个同类型的结果取交集
  and(other: TargetSelector<T> | ChainableSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      let otherResults
      if (other instanceof ChainableSelector) otherResults = other.build()(context)
      else otherResults = other(context)
      return prev.filter(t => otherResults.includes(t))
    }, this.type)
  }

  //两个同类型的结果取并集,相同的值会省略
  or(other: TargetSelector<T>, duplicate: boolean): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      if (!duplicate) return [...new Set([...prev, ...otherResults])]
      return [...prev, ...otherResults]
    }, this.type)
  }

  //对所有的结果进行求和，得到唯一的参数
  sum(this: ChainableSelector<number>): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const values = this.selector(context)
      return [values.reduce((acc, cur) => acc + cur, 0)]
    }, this.type)
  }

  //加一个固定数，或者加一个来源的数。如果来源选择了多个数，则会加上来源的每一个数。
  add(this: ChainableSelector<number>, value: number): ChainableSelector<number>
  add(this: ChainableSelector<number>, selector: ChainableSelector<number>): ChainableSelector<number>
  add(this: ChainableSelector<number>, valueOrSelector: number | ChainableSelector<number>): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => v + valueOrSelector)
    }
    return this.combine(valueOrSelector, (a, b) => a + b)
  }

  // 乘一个固定数，或者乘一个来源的数。如果来源选择了多个数，则会乘上来源的每一个数。
  multiply(this: ChainableSelector<number>, value: number): ChainableSelector<number>
  multiply(this: ChainableSelector<number>, selector: ChainableSelector<number>): ChainableSelector<number>
  multiply(
    this: ChainableSelector<number>,
    valueOrSelector: number | ChainableSelector<number>,
  ): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => Math.floor(v * valueOrSelector))
    }
    return this.combine(valueOrSelector, (a, b) => a * b)
  }

  // 除以一个固定数，或者除以一个来源的数。如果来源选择了多个数，则会除以上来源的每一个数。
  divide(this: ChainableSelector<number>, value: number): ChainableSelector<number>
  divide(this: ChainableSelector<number>, selector: ChainableSelector<number>): ChainableSelector<number>
  divide(
    this: ChainableSelector<number>,
    valueOrSelector: number | ChainableSelector<number>,
  ): ChainableSelector<number> {
    if (typeof valueOrSelector === 'number') {
      return this.mapNumber(v => Math.floor(v / valueOrSelector))
    }
    return this.combine(valueOrSelector, (a, b) => a / b)
  }

  randomPick(count: number): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const list = this.selector(context)
      return context.battle.shuffle(list).slice(0, count) // 使用随机洗牌
    }, this.type)
  }

  length(): ChainableSelector<number> {
    return new ChainableSelector(context => {
      const list = this.selector(context)
      return [list.length]
    }, this.type)
  }

  /**
   * 按百分比概率选取每个目标
   * @param percent 命中概率(0-100)
   **/
  randomSample(percent: number): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(() => context.battle.randomInt(1, 100) <= percent)
    }, this.type)
  }

  /**
   * 对目标列表乱序后返回
   **/
  shuffled(): ChainableSelector<T> {
    return new ChainableSelector(context => context.battle.shuffle(this.selector(context)), this.type)
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
    }, this.type)
  }

  private combine(
    other: ChainableSelector<number>,
    operation: (a: number, b: number) => number,
  ): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const valuesA = this.selector(context) as number[]
      const valuesB = other.selector(context) as number[]
      return valuesA.map((a, i) => operation(a, valuesB[i] ?? 0))
    }, this.type)
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
    return this._isNumberType
  }

  private getPropTypePath(prop: string): string {
    // 从元数据获取属性类型
    const propType = RuntimeTypeChecker.getExpectedType(this.type, prop)

    // 处理数组类型（例如 marks[] -> MarkInstance[]）
    return propType.replace(/\[\]$/, '[]')
  }
}
// 类型增强装饰器
function createChainable<T extends SelectorOpinion>(type: string, selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector, type)
}

export type PrimitiveOpinion = number | string | boolean

export type IdOpinion = skillId | baseSkillId | markId | baseMarkId | speciesId | petId | playerId

export type EnumOpinion = Element | Gender | Nature | Category | AttackTargetOpinion

export type ObjectOpinion =
  | null
  | Battle
  | Pet
  | Player
  | StatOnBattle
  | UseSkillContext
  | DamageContext
  | StatTypeOnBattle
  | Instance
  | MarkInstance
  | SkillInstance
  | CanOwnedEntity
  | OwnedEntity
  | Prototype
  | PropertyRef<any, any>

export type SelectorOpinion = PrimitiveOpinion | ObjectOpinion | EnumOpinion | Array<SelectorOpinion>

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
  target: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext)
      return context.parent.actualTarget ? [context.parent.actualTarget] : []
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  //在使用技能的场景和印记的场景都指向拥有者自身。
  self: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.pet]
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  //在使用技能的场景，指向技能拥有者的敌方玩家的当前首发，在印记的场景指向印记所有者的敌方玩家的当前首发。
  foe: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.actualTarget!]
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!).activePet]
    //TODO: error with use owners with global marks
    return []
  }),
  petOwners: createChainable<Player>('Player', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.pet.owner!]
    if (context.source.owner instanceof Pet) return [context.source.owner.owner!]
    //TODO: error with use owners with global marks
    return []
  }),
  foeOwners: createChainable<Player>('Player', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.actualTarget!.owner!]
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!)]
    //TODO: error with use owners with global marks
    return []
  }),
  usingSkillContext: createChainable<UseSkillContext>('UseSkillContext', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent]
    //TODO: error with use get context with non-Useskill context
    return []
  }),
  damageContext: createChainable<DamageContext>('DamageContext', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof DamageContext) return [context.parent]
    //TODO: error with use get context with non-Damage context
    return []
  }),
  mark: createChainable<MarkInstance>('MarkInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.source instanceof MarkInstance) return [context.source]
    //TODO: error with use get context with non-MarkEffect context
    return []
  }),
  selfMarks: createChainable<MarkInstance>('MarkInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return context.source.owner.marks
    //TODO: error with use owners with global marks
    return []
  }),
  foeMarks: createChainable<MarkInstance>('MarkInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return context.parent.actualTarget!.marks
    if (context.source.owner instanceof Pet)
      return context.battle.getOpponent(context.source.owner.owner!).activePet.marks
    //TODO: error with use owners with global marks
    return []
  }),
}
