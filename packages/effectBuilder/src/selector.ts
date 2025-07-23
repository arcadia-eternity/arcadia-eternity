import {
  Battle,
  DamageContext,
  EffectContext,
  type MarkInstance,
  Pet,
  Player,
  UseSkillContext,
  SkillInstance,
  BaseMark,
  BaseStatLevelMark,
  BaseSkill,
  HealContext,
  AddMarkContext,
  RageContext,
  StackContext,
  ConsumeStackContext,
  SwitchPetContext,
  MarkInstanceImpl,
  type ScopeObject,
  Context,
  type BattlePhaseBase,
} from '@arcadia-eternity/battle'
import { Observable, combineLatest, map } from 'rxjs'
import {
  TurnContext,
  type CanOwnedEntity,
  type Instance,
  type OwnedEntity,
  type Prototype,
} from '@arcadia-eternity/battle'
import {
  AttackTargetOpinion,
  Category,
  EffectTrigger,
  Element,
  Gender,
  IgnoreStageStrategy,
  Nature,
  StackStrategy,
  type baseMarkId,
  type baseSkillId,
  type effectId,
  type markId,
  type petId,
  type playerId,
  type skillId,
  type speciesId,
  type StatOnBattle,
  type StatTypeOnBattle,
} from '@arcadia-eternity/const'
import type {
  Action,
  Condition,
  Evaluator,
  Operator,
  TargetSelector,
  ValueExtractor,
  ValueSource,
} from './effectBuilder'
import { createExtractor, type PathExtractor } from './extractor'
import { RuntimeTypeChecker } from './runtime-type-checker'
import { GetValueFromSource } from './operator'
import { DataRepository } from '@arcadia-eternity/data-repository'

export type PropertyRef<T, V> = {
  get: () => V
  set: (value: V) => void
  target: T // 保留原对象引用
}

export type ObservableRef<T, V> = {
  get: () => V
  get$: () => Observable<V>
  set: (value: V) => void
  target: T // 保留原对象引用
}

//TODO:PropertyRef的类型和select时的行为
export class ChainableSelector<T> {
  private readonly _isNumberType: boolean
  constructor(
    public selector: TargetSelector<T>,
    public type: string,
  ) {
    this._isNumberType =
      RuntimeTypeChecker.isNumberType(type) || type === 'number' || type === 'number[]' || type.includes('number')
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

  // 新方法：选择属性的Observable引用
  selectObservable<K extends keyof NonNullable<T>>(
    prop: K,
  ): T extends object ? ChainableSelector<ObservableRef<NonNullable<T>, NonNullable<T>[K]>> : never {
    const newTypePath = this.getPropTypePath(prop as string)
    return new ChainableSelector(
      context =>
        this.selector(context)
          .filter((target): target is NonNullable<T> => !!target)
          .map(target => {
            // 检查目标是否有attributeSystem和getAttribute$方法
            const hasAttributeSystem = target && typeof target === 'object' && 'attributeSystem' in target
            const attributeSystem = hasAttributeSystem ? (target as any).attributeSystem : null

            return {
              target: target as NonNullable<T>,
              get: () => (target as NonNullable<T>)[prop],
              get$: () => {
                if (attributeSystem && typeof attributeSystem.getAttribute$ === 'function') {
                  return attributeSystem.getAttribute$(prop as string)
                }
                // 如果没有attributeSystem，返回一个包含当前值的Observable
                return new Observable(subscriber => {
                  subscriber.next((target as NonNullable<T>)[prop])
                  subscriber.complete()
                })
              },
              set: (value: NonNullable<T>[K]) => {
                ;(target as NonNullable<T>)[prop] = value
              },
            }
          }),
      newTypePath,
    ) as T extends object ? ChainableSelector<ObservableRef<NonNullable<T>, NonNullable<T>[K]>> : never
  }

  // 专门用于attribute的Observable选择器
  selectAttribute$<K extends string>(attributeName: K): ChainableSelector<Observable<number | boolean | string>> {
    return new ChainableSelector(
      context =>
        this.selector(context)
          .filter((target): target is NonNullable<T> => !!target)
          .map(target => {
            // 检查目标是否有attributeSystem
            const hasAttributeSystem = target && typeof target === 'object' && 'attributeSystem' in target
            const attributeSystem = hasAttributeSystem ? (target as any).attributeSystem : null

            if (attributeSystem && typeof attributeSystem.getAttribute$ === 'function') {
              return attributeSystem.getAttribute$(attributeName)
            }

            // 如果没有attributeSystem，返回一个空的Observable
            return new Observable(subscriber => {
              subscriber.error(new Error(`Target does not have attributeSystem: ${target}`))
            })
          }),
      'Observable<number | boolean | string>',
    )
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

    return new ChainableSelector(context => this.selector(context).map(createExtractor(path)), newType)
  }

  //选择一组对象的某一个参数
  select<U>(extractor: PathExtractor<T, U>): ChainableSelector<U>
  select<U>(extractor: ValueExtractor<T, U>, extractorPath?: string): ChainableSelector<U>
  select<U>(extractor: PathExtractor<T, U> | ValueExtractor<T, U>, extractorPath?: string): ChainableSelector<U> {
    if (typeof extractor !== 'function') {
      return this.createExtractedSelector(extractor)
    }

    // 开发环境下的路径验证
    if (process.env.NODE_ENV !== 'production' && extractorPath !== undefined && this.type !== 'any') {
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
    // 开发环境类型校验
    if (process.env.NODE_ENV !== 'production') {
      if (!RuntimeTypeChecker.validatePath(this.type, extractor.path)) {
        throw new Error(`[类型错误] 路径 ${extractor.path} 在 ${this.type} 中不存在`)
      }
    }

    return new ChainableSelector<U>(context => this.selector(context).map(extractor.extract), extractor.type)
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

  flat(): ChainableSelector<T extends Array<infer U> ? U : T> {
    return new ChainableSelector(
      context => {
        const results = this.selector(context)
        return results.flat() as T extends Array<infer U> ? U[] : T[]
      },
      this.type.replace(/\[\]$/, ''),
    ) as ChainableSelector<T extends Array<infer U> ? U : T>
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
  sum(this: ChainableSelector<number>): ChainableSelector<number>
  sum(this: ChainableSelector<Observable<number>>): ChainableSelector<Observable<number>>
  sum(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        if (observables.length === 0) {
          return [
            new Observable(subscriber => {
              subscriber.next(0)
              subscriber.complete()
            }),
          ]
        }
        if (observables.length === 1) {
          return observables
        }
        // 使用combineLatest来组合多个Observable并求和
        const combined = combineLatest(observables).pipe(map(values => values.reduce((acc, cur) => acc + cur, 0)))
        return [combined]
      }, 'Observable<number>')
    }
    return new ChainableSelector<number>(context => {
      const values = this.selector(context) as number[]
      return [values.reduce((acc, cur) => acc + cur, 0)]
    }, this.type)
  }

  //对所有的结果进行求平均值，得到唯一的参数
  avg(this: ChainableSelector<number>): ChainableSelector<number>
  avg(this: ChainableSelector<Observable<number>>): ChainableSelector<Observable<number>>
  avg(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        if (observables.length === 0) {
          return [
            new Observable(subscriber => {
              subscriber.next(0)
              subscriber.complete()
            }),
          ]
        }
        if (observables.length === 1) {
          return observables
        }
        // 使用combineLatest来组合多个Observable并求平均值
        const combined = combineLatest(observables).pipe(
          map(values => values.reduce((acc, cur) => acc + cur, 0) / values.length),
        )
        return [combined]
      }, 'Observable<number>')
    }
    return new ChainableSelector<number>(context => {
      const values = this.selector(context) as number[]
      if (values.length === 0) return [0]
      return [values.reduce((acc, cur) => acc + cur, 0) / values.length]
    }, this.type)
  }

  //加一个固定数，或者加一个来源的数。如果来源选择了多个数，则会加上来源的每一个数。
  add(this: ChainableSelector<number>, valueSource: ValueSource<number>): ChainableSelector<number>
  add(
    this: ChainableSelector<Observable<number>>,
    valueSource: ValueSource<number>,
  ): ChainableSelector<Observable<number>>
  add(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
    valueSource: ValueSource<number>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        const values = GetValueFromSource(context, valueSource)
        return observables.map((obs, i) => obs.pipe(map(val => val + (values[i] ?? 0))))
      }, 'Observable<number>')
    }
    return this.combine(valueSource, (a, b) => a + b)
  }

  // 乘一个固定数，或者乘一个来源的数。如果来源选择了多个数，则会乘上来源的每一个数。
  multiply(this: ChainableSelector<number>, valueSource: ValueSource<number>): ChainableSelector<number>
  multiply(
    this: ChainableSelector<Observable<number>>,
    valueSource: ValueSource<number>,
  ): ChainableSelector<Observable<number>>
  multiply(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
    valueSource: ValueSource<number>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        const values = GetValueFromSource(context, valueSource)
        return observables.map((obs, i) => obs.pipe(map(val => Math.floor(val * (values[i] ?? 1)))))
      }, 'Observable<number>')
    }
    return this.combine(valueSource, (a, b) => Math.floor(a * b))
  }

  // 除以一个固定数，或者除以一个来源的数。如果来源选择了多个数，则会除以上来源的每一个数。
  divide(this: ChainableSelector<number>, valueSource: ValueSource<number>): ChainableSelector<number>
  divide(
    this: ChainableSelector<Observable<number>>,
    valueSource: ValueSource<number>,
  ): ChainableSelector<Observable<number>>
  divide(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
    valueSource: ValueSource<number>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        const values = GetValueFromSource(context, valueSource)
        return observables.map((obs, i) => {
          const divisor = values[i] ?? 1
          if (divisor === 0) throw new Error('Division by zero in Observable operation')
          return obs.pipe(map(val => Math.floor(val / divisor)))
        })
      }, 'Observable<number>')
    }
    return this.combine(valueSource, (a, b) => Math.floor(a / b))
  }

  randomPick(count: ValueSource<number>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const list = this.selector(context)
      const _count = GetValueFromSource(context, count)
      if (_count.length === 0) return []
      return context.battle.shuffle(list).slice(0, _count[0]) // 使用随机洗牌
    }, this.type)
  }

  length(): ChainableSelector<number> {
    return new ChainableSelector(context => {
      const list = this.selector(context)
      return [list.length]
    }, 'number')
  }

  /**
   * 按百分比概率选取每个目标
   * @param percent 命中概率(0-100)
   **/
  randomSample(percent: ValueSource<number>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const _percent = GetValueFromSource(context, percent)
      if (_percent.length === 0) return []
      return this.selector(context).filter(() => context.battle.randomInt(1, 100) <= _percent[0])
    }, this.type)
  }

  /**
   * 对目标列表乱序后返回
   **/
  shuffled(): ChainableSelector<T> {
    return new ChainableSelector(context => context.battle.shuffle(this.selector(context)), this.type)
  }

  // 最大值限制
  clampMax(this: ChainableSelector<number>, max: ValueSource<number>): ChainableSelector<number>
  clampMax(this: ChainableSelector<Observable<number>>, max: ValueSource<number>): ChainableSelector<Observable<number>>
  clampMax(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
    max: ValueSource<number>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        const maxValues = GetValueFromSource(context, max)
        return observables.map((obs, i) => obs.pipe(map(val => Math.min(val, maxValues[i] ?? Number.MAX_SAFE_INTEGER))))
      }, 'Observable<number>')
    }
    return this.mapNumber(max, (v, value) => Math.min(v, value))
  }

  // 最小值限制
  clampMin(this: ChainableSelector<number>, min: ValueSource<number>): ChainableSelector<number>
  clampMin(this: ChainableSelector<Observable<number>>, min: ValueSource<number>): ChainableSelector<Observable<number>>
  clampMin(
    this: ChainableSelector<number> | ChainableSelector<Observable<number>>,
    min: ValueSource<number>,
  ): ChainableSelector<number> | ChainableSelector<Observable<number>> {
    if (this.type.includes('Observable')) {
      return new ChainableSelector<Observable<number>>(context => {
        const observables = this.selector(context) as Observable<number>[]
        const minValues = GetValueFromSource(context, min)
        return observables.map((obs, i) => obs.pipe(map(val => Math.max(val, minValues[i] ?? Number.MIN_SAFE_INTEGER))))
      }, 'Observable<number>')
    }
    return this.mapNumber(min, (v, value) => Math.max(v, value))
  }

  limit(limit: ValueSource<number>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const _limit = GetValueFromSource(context, limit)
      if (_limit.length === 0) return this.selector(context)
      return this.selector(context).slice(0, _limit[0])
    }, this.type)
  }

  when<U extends SelectorOpinion>(
    condition: Condition,
    valueTrue: ValueSource<U>,
    valueFalse?: ValueSource<U>,
    type?: string,
  ): ChainableSelector<U> {
    return new ChainableSelector(context => {
      const _condition = this.condition(condition)(context)
      const _valueTrue = GetValueFromSource(context, valueTrue)
      const _valueFalse = valueFalse ? GetValueFromSource(context, valueFalse) : undefined
      if (_valueTrue.length === 0) return []
      return _condition ? _valueTrue : (_valueFalse ?? [])
    }, type ?? 'any')
  }

  // 公共数值处理方法
  private mapNumber(
    numberSource: ValueSource<number>,
    fn: (v: number, value: number) => number,
  ): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const values = this.selector(context) as number[]
      const numberValues = GetValueFromSource(context, numberSource)
      return values.map((v, i) => fn(v, numberValues[i] ?? 0))
    }, this.type)
  }

  private combine(other: ValueSource<number>, operation: (a: number, b: number) => number): ChainableSelector<number> {
    return new ChainableSelector<number>(context => {
      const valuesA = this.selector(context) as number[]
      const valuesB = GetValueFromSource(context, other)
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

  configGet(this: ChainableSelector<ScopeObject>, key: ValueSource<string>) {
    return new ChainableSelector(context => {
      const _key = GetValueFromSource(context, key)
      if (_key.length === 0) return []
      return this.selector(context).map(target => context.battle.configSystem.get(_key[0], target))
    }, 'any') //TODO: 这里的类型
  }

  // 类型转换方法：将BaseMark转换为BaseStatLevelMark
  asStatLevelMark(): ChainableSelector<BaseStatLevelMark> {
    return new ChainableSelector<BaseStatLevelMark>(context => {
      return this.selector(context).filter(
        (item: any): item is BaseStatLevelMark => item instanceof BaseStatLevelMark,
      ) as BaseStatLevelMark[]
    }, 'BaseStatLevelMark')
  }
}
// 类型增强装饰器
function createChainable<T extends SelectorOpinion>(type: string, selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector, type)
}

export type PrimitiveOpinion = number | string | boolean

export type IdOpinion = skillId | baseSkillId | markId | baseMarkId | speciesId | petId | playerId | effectId

export type EnumOpinion =
  | Element
  | Gender
  | Nature
  | Category
  | AttackTargetOpinion
  | StackStrategy
  | IgnoreStageStrategy

export type ObjectOpinion =
  | null
  | Battle
  | Pet
  | Player
  | StatOnBattle
  | UseSkillContext
  | TurnContext
  | EffectContext<EffectTrigger>
  | DamageContext
  | HealContext
  | AddMarkContext
  | RageContext
  | StackContext
  | ConsumeStackContext
  | SwitchPetContext
  | StatTypeOnBattle
  | Instance
  | BaseMark
  | MarkInstance
  | BaseSkill
  | SkillInstance
  | CanOwnedEntity
  | OwnedEntity
  | Prototype
  | PropertyRef<any, any>
  | ObservableRef<any, any>
  | Observable<any>
  | BattlePhaseBase

export type SelectorOpinion = PrimitiveOpinion | ObjectOpinion | EnumOpinion | Array<SelectorOpinion>

// 递归查找context的通用函数
export function findContextRecursively<T extends Context, U extends EffectTrigger>(
  context: EffectContext<U>,
  contextType: new (...args: any[]) => T,
): T | null {
  let currentCtx: any = context
  while (!(currentCtx instanceof Battle)) {
    if (currentCtx instanceof contextType) {
      return currentCtx
    }
    if (!currentCtx.parent) break
    currentCtx = currentCtx.parent
  }
  return null
}

// 基础选择器
export const BaseSelector: {
  target: ChainableSelector<Pet>
  self: ChainableSelector<Pet>
  opponent: ChainableSelector<Pet>
  selfTeam: ChainableSelector<Pet>
  opponentTeam: ChainableSelector<Pet>
  selfPlayer: ChainableSelector<Player>
  opponentPlayer: ChainableSelector<Player>
  useSkillContext: ChainableSelector<UseSkillContext>
  damageContext: ChainableSelector<DamageContext>
  effectContext: ChainableSelector<EffectContext<EffectTrigger>>
  mark: ChainableSelector<MarkInstance>
  selfMarks: ChainableSelector<MarkInstance>
  opponentMarks: ChainableSelector<MarkInstance>
  skill: ChainableSelector<SkillInstance>
  selfSkills: ChainableSelector<SkillInstance>
  opponentSkills: ChainableSelector<SkillInstance>
  selfAvailableSkills: ChainableSelector<SkillInstance>
  opponentAvailableSkills: ChainableSelector<SkillInstance>
  dataMarks: ChainableSelector<BaseMark>
  healContext: ChainableSelector<HealContext>
  addMarkContext: ChainableSelector<AddMarkContext>
  rageContext: ChainableSelector<RageContext>
  stackContext: ChainableSelector<StackContext>
  consumeStackContext: ChainableSelector<ConsumeStackContext>
  switchPetContext: ChainableSelector<SwitchPetContext>
  battle: ChainableSelector<Battle>
  turnContext: ChainableSelector<TurnContext>
  currentPhase: ChainableSelector<BattlePhaseBase>
  allPhases: ChainableSelector<BattlePhaseBase>
} = {
  //选择目标，在使用技能的场景下，为技能实际指向的目标，在印记的场景下指向印记的所有者。
  target: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext)
      return context.parent.actualTarget ? [context.parent.actualTarget] : []
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  //始终指向效果的拥有者自身。
  self: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return [context.source.owner]
    //TODO: error with use owners with global marks
    return []
  }),
  //始终指向效果的拥有者的当前对手。
  opponent: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!).activePet]
    //TODO: error with use owners with global marks
    return []
  }),
  //选择效果拥有者的全队精灵。
  selfTeam: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [...context.parent.pet.owner!.team]
    if (context.source.owner instanceof Pet) return [...context.source.owner.owner!.team]
    //TODO: error with use owners with global marks
    return []
  }),
  //选择效果拥有者对手的全队精灵。
  opponentTeam: createChainable<Pet>('Pet', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [...context.parent.actualTarget!.owner!.team]
    if (context.source.owner instanceof Pet) return [...context.battle.getOpponent(context.source.owner.owner!).team]
    //TODO: error with use owners with global marks
    return []
  }),
  selfPlayer: createChainable<Player>('Player', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.pet.owner!]
    if (context.source.owner instanceof Pet) return [context.source.owner.owner!]
    //TODO: error with use owners with global marks
    return []
  }),
  opponentPlayer: createChainable<Player>('Player', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [context.parent.actualTarget!.owner!]
    if (context.source.owner instanceof Pet) return [context.battle.getOpponent(context.source.owner.owner!)]
    //TODO: error with use owners with global marks
    return []
  }),
  useSkillContext: createChainable<UseSkillContext>('UseSkillContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, UseSkillContext)
    return foundContext ? [foundContext] : []
  }),
  damageContext: createChainable<DamageContext>('DamageContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, DamageContext)
    return foundContext ? [foundContext] : []
  }),
  effectContext: createChainable<EffectContext<EffectTrigger>>(
    'EffectContext',
    (context: EffectContext<EffectTrigger>) => {
      // 从父context开始查找，避免返回自身
      let currentCtx: any = context.parent
      while (currentCtx && !(currentCtx instanceof Battle)) {
        if (currentCtx instanceof EffectContext) {
          return [currentCtx]
        }
        currentCtx = currentCtx.parent
      }
      return []
    },
  ),
  skill: createChainable<SkillInstance>('SkillInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.source instanceof SkillInstance) return [context.source]
    //TODO: error with use get context with non-SkillEffect context
    return []
  }),
  mark: createChainable<MarkInstance>('MarkInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.source instanceof MarkInstanceImpl) return [context.source]
    //TODO: error with use get context with non-MarkEffect context
    return []
  }),
  selfMarks: createChainable<MarkInstance>('MarkInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.source.owner instanceof Pet) return context.source.owner.marks
    //TODO: error with use owners with global marks
    return []
  }),
  opponentMarks: createChainable<MarkInstance>('MarkInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return context.parent.actualTarget!.marks
    if (context.source.owner instanceof Pet)
      return context.battle.getOpponent(context.source.owner.owner!).activePet.marks
    //TODO: error with use owners with global marks
    return []
  }),
  selfSkills: createChainable<SkillInstance>('SkillInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [...context.parent.pet.skills]
    if (context.source.owner instanceof Pet) return [...context.source.owner.skills]
    return []
  }),
  opponentSkills: createChainable<SkillInstance>('SkillInstance', (context: EffectContext<EffectTrigger>) => {
    if (context.parent instanceof UseSkillContext) return [...context.parent.actualTarget!.skills]
    if (context.source.owner instanceof Pet)
      return [...context.battle.getOpponent(context.source.owner.owner!).activePet.skills]
    //TODO: error with use owners with global marks
    return []
  }),
  selfAvailableSkills: createChainable<SkillInstance>('SkillInstance', (context: EffectContext<EffectTrigger>) => {
    let pet: Pet
    if (context.parent instanceof UseSkillContext) {
      pet = context.parent.pet
    } else if (context.source.owner instanceof Pet) {
      pet = context.source.owner
    } else return []

    return [...pet.skills].filter(skill => skill.rage <= pet.currentRage)
  }),
  opponentAvailableSkills: createChainable<SkillInstance>('SkillInstance', (context: EffectContext<EffectTrigger>) => {
    let pet: Pet
    if (context.parent instanceof UseSkillContext) {
      pet = context.parent.actualTarget!
    } else if (context.source.owner instanceof Pet) {
      pet = context.battle.getOpponent(context.source.owner.owner!).activePet
    } else return []

    return [...pet.skills].filter(skill => skill.rage <= pet.currentRage)
  }),
  dataMarks: createChainable<BaseMark>('BaseMark', (_context: EffectContext<EffectTrigger>) => {
    return DataRepository.getInstance().getAllMarks()
  }),
  healContext: createChainable<HealContext>('HealContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, HealContext)
    return foundContext ? [foundContext] : []
  }),
  addMarkContext: createChainable<AddMarkContext>('AddMarkContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, AddMarkContext)
    return foundContext ? [foundContext] : []
  }),
  rageContext: createChainable<RageContext>('RageContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, RageContext)
    return foundContext ? [foundContext] : []
  }),
  stackContext: createChainable<StackContext>('StackContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, StackContext)
    return foundContext ? [foundContext] : []
  }),
  consumeStackContext: createChainable<ConsumeStackContext>(
    'ConsumeStackContext',
    (context: EffectContext<EffectTrigger>) => {
      const foundContext = findContextRecursively(context, ConsumeStackContext)
      return foundContext ? [foundContext] : []
    },
  ),
  switchPetContext: createChainable<SwitchPetContext>('SwitchPetContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, SwitchPetContext)
    return foundContext ? [foundContext] : []
  }),
  battle: createChainable<Battle>('Battle', (context: EffectContext<EffectTrigger>) => {
    return [context.battle]
  }),
  turnContext: createChainable<TurnContext>('TurnContext', (context: EffectContext<EffectTrigger>) => {
    const foundContext = findContextRecursively(context, TurnContext)
    return foundContext ? [foundContext] : []
  }),

  // 选择当前正在执行的phase
  currentPhase: createChainable<BattlePhaseBase>('BattlePhaseBase', (context: EffectContext<EffectTrigger>) => {
    const currentPhase = context.battle.phaseManager.getCurrentPhase()
    return currentPhase ? [currentPhase] : []
  }),

  // 选择所有已注册的phases
  allPhases: createChainable<BattlePhaseBase>('BattlePhaseBase', (context: EffectContext<EffectTrigger>) => {
    return context.battle.phaseManager.getAllPhases()
  }),
}
