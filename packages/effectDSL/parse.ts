import { Effect, MarkInstance, Pet, Player, UseSkillContext } from '@test-battle/battle'
import {
  type baseMarkId,
  type effectId,
  EffectTrigger,
  type markId,
  type StatTypeOnBattle,
  StatTypeWithoutHp,
} from '@test-battle/const'
import { DataRepository } from '@test-battle/data-repository'
import {
  BaseSelector,
  ChainableSelector,
  type Condition,
  Conditions,
  createExtractor,
  type Evaluator,
  Extractor,
  isMark,
  isOwnedEntity,
  isPet,
  isPlayer,
  isUseSkillContext,
  Operators,
  type SelectorOpinion,
  type ValueExtractor,
  type ValueSource,
} from '@test-battle/effect-builder'
import type { ActionDSL, ConditionDSL, EffectDSL, EvaluatorDSL, SelectorDSL, Value } from './dsl'

export function parseEffect(dsl: EffectDSL): Effect<EffectTrigger> {
  const actions = createAction(dsl.apply)
  const condition = dsl.condition ? parseCondition(dsl.condition) : undefined
  return new Effect(dsl.id as effectId, dsl.trigger, actions, dsl.priority, condition)
}

export function parseSelector<T extends SelectorOpinion>(dsl: SelectorDSL): ChainableSelector<T> {
  let selector: ChainableSelector<SelectorOpinion>

  // 处理基础选择器
  if (typeof dsl === 'string') {
    if (!(dsl in BaseSelector)) {
      throw new Error(`未知的基础选择器: ${dsl}`)
    }
    selector = BaseSelector[dsl as keyof typeof BaseSelector]
  } else {
    const base = dsl.base
    if (!(base in BaseSelector)) {
      throw new Error(`未知的基础选择器: ${base}`)
    }
    selector = BaseSelector[base as keyof typeof BaseSelector]

    // 处理链式操作
    if (!dsl.chain) return selector as ChainableSelector<T>
    for (const step of dsl.chain) {
      try {
        switch (step.type) {
          case 'select': {
            // 动态推断当前泛型类型
            type CurrentType = typeof selector._type
            const extractor = parseExtractor<CurrentType>(step.arg)
            selector = selector.select(extractor)
            break
          }
          case 'where': {
            const condition = parseEvaluator(step.arg)
            selector = selector.where(condition)
            break
          }
          case 'whereAttr': {
            type CurrentType = typeof selector._type
            const extractor = parseExtractor<CurrentType>(step.extractor)
            const condition = parseEvaluator(step.condition)
            selector = selector.whereAttr(extractor, condition)
            break
          }
          case 'and': {
            const otherSelector = parseSelector(step.arg).build()
            selector = selector.and(otherSelector)
            break
          }
          case 'or': {
            const otherSelector = parseSelector(step.arg).build()
            selector = selector.or(otherSelector, step.duplicate ?? false)
            break
          }
          case 'randomPick':
            selector = selector.randomPick(step.arg)
            break
          case 'randomSample':
            selector = selector.randomSample(step.arg)
            break
          case 'sum': {
            if (!selector.isNumberType()) {
              throw new Error(`sum操作需要数值类型选择器，当前类型为${typeof selector._type}`)
            }
            const numberSelector = selector as ChainableSelector<number>
            selector = numberSelector.sum()
            break
          }
          case 'add': {
            if (typeof step.arg === 'number') {
              selector = selector.add(step.arg)
            } else {
              const otherSelector = parseSelector<number>(step.arg)
              selector = selector.add(otherSelector)
            }
            break
          }
          case 'multiply': {
            if (typeof step.arg === 'number') {
              selector = selector.multiply(step.arg)
            } else {
              const otherSelector = parseSelector<number>(step.arg)
              selector = selector.multiply(otherSelector)
            }
            break
          }
          case 'divide': {
            if (typeof step.arg === 'number') {
              selector = selector.divide(step.arg)
            } else {
              const otherSelector = parseSelector<number>(step.arg)
              selector = selector.divide(otherSelector)
            }
            break
          }
          case 'shuffled':
            selector = selector.shuffled()
            break
          case 'clampMax':
            selector = selector.clampMax(step.arg)
            break
          case 'clampMin':
            selector = selector.clampMin(step.arg)
            break
          default:
            throw new Error(`未知的操作类型: ${(step as { type: string }).type}`)
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        throw new Error(`步骤[${step.type}]执行失败: ${error.message}`)
      }
    }
  }

  // 最终类型断言为调用方期望的类型
  return selector as ChainableSelector<T>
}

export function parseExtractor<T extends SelectorOpinion>(
  value: keyof typeof Extractor | string,
): ValueExtractor<T, SelectorOpinion> {
  // 处理内置提取器
  const builtInExtractor = value in Extractor ? Extractor[value as keyof typeof Extractor] : null

  if (builtInExtractor) {
    // 返回带运行时类型检查的包装函数
    return (target: T) => {
      try {
        // 根据提取器类型进行运行时验证
        switch (value) {
          case 'hp':
          case 'maxhp':
          case 'type':
          case 'marks':
          case 'stats':
          case 'skills':
            if (!isPet(target)) {
              throw new Error(`提取器'${value}'需要Pet类型目标，但传入的是${target?.constructor.name}`)
            }
            break
          case 'rage':
          case 'activePet':
            if (!isPlayer(target)) {
              throw new Error(`提取器'${value}'需要Player类型目标，但传入的是${target?.constructor.name}`)
            }
            break
          case 'owner':
            if (!isOwnedEntity(target)) {
              throw new Error(`提取器'owner'需要拥有owner属性的对象，但传入的是${target?.constructor.name}`)
            }
            break
          case 'stack':
          case 'duration':
          case 'id':
          case 'tags':
            if (!isMark(target)) {
              throw new Error(`提取器'${value}'需要Mark类型目标，但传入的是${target?.constructor.name}`)
            }
            break
          case 'power':
          case 'priority':
            if (!isUseSkillContext(target)) {
              throw new Error(`提取器'${value}'需要UseSkillContext类型目标，但传入的是${target?.constructor.name}`)
            }
            break
        }

        // 执行实际提取逻辑
        return builtInExtractor(target as never)
      } catch (e) {
        throw new Error(`提取器'${value}'执行失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // 处理动态路径提取器（例如通过createExtractor生成的）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicExtractor = createExtractor<T, any>(value)

  // 添加基础类型检查（确保目标为对象）
  return (target: T) => {
    if (typeof target !== 'object' || target === null) {
      throw new Error(`动态提取器'${value}'需要对象类型目标，但传入的是${typeof target}`)
    }
    const result = dynamicExtractor(target)

    return result as SelectorOpinion
  }
}

function parseEvaluator(dsl: EvaluatorDSL): Evaluator<SelectorOpinion> {
  switch (dsl.type) {
    case 'compare':
      return Conditions.compare(
        dsl.operator,
        parseValue(dsl.value) as ValueSource<number>,
      ) as Evaluator<SelectorOpinion>
    case 'same':
      return Conditions.same(
        parseValue(dsl.value) as ValueSource<number | string | boolean>,
      ) as Evaluator<SelectorOpinion>
    case 'any':
      // 递归解析嵌套条件（OR 逻辑）
      return Conditions.any(...dsl.conditions.map(v => parseEvaluator(v)))
    case 'all':
      // 递归解析嵌套条件（AND 逻辑）
      return Conditions.all(...dsl.conditions.map(v => parseEvaluator(v)))
    case 'probability':
      return Conditions.probability(parseValue(dsl.percent) as ValueSource<number>)
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown condition type: ${(dsl as any).type}`)
    }
  }
}

export function createAction(dsl: ActionDSL) {
  switch (dsl.type) {
    case 'dealDamage':
      return parseDamageAction(dsl)
    case 'heal':
      return parseHealAction(dsl)
    case 'addMark':
      return parseAddMarkAction(dsl)
    case 'addStacks':
      return parseAddStacksAction(dsl)
    case 'consumeStacks':
      return parseConsumeStacksAction(dsl)
    case 'modifyStat':
      return parseModifyStatAction(dsl)
    case 'statStageBuff':
      return parseStatStageBuffAction(dsl)
    case 'addRage':
      return parseAddRageAction(dsl)
    case 'amplifyPower':
      return parseAmplifyPowerAction(dsl)
    case 'addPower':
      return parseAddPowerAction(dsl)
    case 'transferMark':
      return parseTransferMark(dsl)
  }
}

// Common value parser reused across actions [source_id: parse.ts]
export function parseValue(v: Value): string | number | boolean | ChainableSelector<SelectorOpinion> {
  if (v.type === 'raw:number') return v.value as number
  if (v.type === 'raw:string') return v.value as string
  if (v.type === 'raw:boolean') return v.value as boolean
  if (v.type === 'raw:markId') return v.value as string
  return parseSelector(v.selector)
}

export function isNumberValue(value: ValueSource<SelectorOpinion>): value is number {
  return typeof value === 'number'
}

export function parseDamageAction(dsl: Extract<ActionDSL, { type: 'dealDamage' }>) {
  const value = parseValue(dsl.value)
  if (!isNumberValue(value)) {
    throw new Error('Damage value must be a number')
  }
  return parseSelector<Pet>(dsl.target).apply(Operators.dealDamage(parseValue(dsl.value) as ValueSource<number>))
}

export function parseHealAction(dsl: Extract<ActionDSL, { type: 'heal' }>) {
  const selector = parseSelector<Pet>(dsl.target)
  return selector.apply(Operators.heal(parseValue(dsl.value) as ValueSource<number>))
}

export function parseAddMarkAction(dsl: Extract<ActionDSL, { type: 'addMark' }>) {
  const selector = parseSelector<Pet>(dsl.target)
  const mark = DataRepository.getInstance().getMark(dsl.mark as baseMarkId)
  return selector.apply(Operators.addMark(mark, dsl.duration))
}

// Pattern for stack-related actions [source_id: operator.ts]
export function parseAddStacksAction(dsl: Extract<ActionDSL, { type: 'addStacks' }>) {
  return parseSelector<MarkInstance>(dsl.target).apply(Operators.addStack(dsl.value))
}

export function parseConsumeStacksAction(dsl: Extract<ActionDSL, { type: 'consumeStacks' }>) {
  return parseSelector<MarkInstance>(dsl.target).apply(Operators.consumeStacks(dsl.value))
}

// Stat modification pattern [source_id: parse.ts]
export function parseModifyStatAction(dsl: Extract<ActionDSL, { type: 'modifyStat' }>) {
  return parseSelector<Pet>(dsl.target).apply(
    Operators.modifyStat(
      parseValue(dsl.statType) as ValueSource<StatTypeOnBattle>,
      parseValue(dsl.value) as ValueSource<number>,
      parseValue(dsl.percent) as ValueSource<number>,
    ),
  )
}

export function parseStatStageBuffAction(dsl: Extract<ActionDSL, { type: 'statStageBuff' }>) {
  return parseSelector<Pet>(dsl.target).apply(
    Operators.statStageBuff(
      parseValue(dsl.statType) as ValueSource<StatTypeWithoutHp>,
      parseValue(dsl.value) as ValueSource<number>,
    ),
  )
}

// Utility action handlers [source_id: operator.ts]
export function parseAddRageAction(dsl: Extract<ActionDSL, { type: 'addRage' }>) {
  return parseSelector<Player>(dsl.target).apply(Operators.addRage(parseValue(dsl.value) as ValueSource<number>))
}

export function parseAmplifyPowerAction(dsl: Extract<ActionDSL, { type: 'amplifyPower' }>) {
  return parseSelector<UseSkillContext>(dsl.target).apply(
    Operators.amplifyPower(parseValue(dsl.value) as ValueSource<number>),
  )
}

export function parseAddPowerAction(dsl: Extract<ActionDSL, { type: 'addPower' }>) {
  return parseSelector<UseSkillContext>(dsl.target).apply(
    Operators.addPower(parseValue(dsl.value) as ValueSource<number>),
  )
}

export function parseTransferMark(dsl: Extract<ActionDSL, { type: 'transferMark' }>) {
  return parseSelector<Pet>(dsl.target).apply(Operators.transferMark(parseValue(dsl.mark) as ValueSource<MarkInstance>))
}

export function parseCondition(dsl: ConditionDSL): Condition {
  const target = parseSelector(dsl.target)
  const evaluator = parseEvaluator(dsl.evaluator)
  return target.condition(evaluator)
}
