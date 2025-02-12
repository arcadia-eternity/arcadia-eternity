import {
  BaseSelector,
  ChainableSelector,
  createExtractor,
  Extractor,
  isMark,
  isOwnedEntity,
  isPet,
  isPlayer,
  isUseSkillContext,
  SelectorOpinion,
  ValueSource,
} from '@/effectBuilder/selector'
import { ActionDSL, SelectorDSL, ConditionDSL, Value } from './dsl'
import { Conditions } from '@/effectBuilder/condition'
import { Operators } from '@/effectBuilder/operator'
import { ConditionOperator, ValueExtractor } from '@/effectBuilder/effectBuilder'
import { DataRepository } from '@/daraRespository/dataRepository'
import { Pet } from '@/core/pet'
import { Mark } from '@/core/mark'
import { StatTypeOnBattle, StatTypeWithoutHp } from '@/core/const'
import { Player } from '@/core/player'
import { UseSkillContext } from '@/core/context'

function parseSelector<T extends SelectorOpinion>(dsl: SelectorDSL): ChainableSelector<T> {
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
    for (const step of dsl.chain) {
      try {
        switch (step.type) {
          case 'select': {
            // 动态推断当前泛型类型
            type CurrentType = typeof selector._type
            const extractor = parseExtractor<CurrentType>(step.arg)
            selector = selector.select(extractor) as ChainableSelector<SelectorOpinion>
            break
          }
          case 'where': {
            const condition = parseCondition(step.arg)
            selector = selector.where(condition)
            break
          }
          case 'whereAttr': {
            type CurrentType = typeof selector._type
            const extractor = parseExtractor<CurrentType>(step.extractor)
            const condition = parseCondition(step.condition)
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
          case 'sum':
            selector = (selector as unknown as ChainableSelector<number>).sum() as ChainableSelector<SelectorOpinion>
            break
          case 'add': {
            if (typeof step.arg === 'number') {
              selector = selector.add(step.arg) as ChainableSelector<SelectorOpinion>
            } else {
              const otherSelector = parseSelector<number>(step.arg)
              selector = selector.add(otherSelector) as ChainableSelector<SelectorOpinion>
            }
            break
          }
          case 'multiply': {
            if (typeof step.arg === 'number') {
              selector = selector.multiply(step.arg) as ChainableSelector<SelectorOpinion>
            } else {
              const otherSelector = parseSelector<number>(step.arg)
              selector = selector.multiply(otherSelector) as ChainableSelector<SelectorOpinion>
            }
            break
          }
          case 'divide': {
            if (typeof step.arg === 'number') {
              selector = selector.divide(step.arg) as ChainableSelector<SelectorOpinion>
            } else {
              const otherSelector = parseSelector<number>(step.arg)
              selector = selector.divide(otherSelector) as ChainableSelector<SelectorOpinion>
            }
            break
          }
          case 'shuffled':
            selector = selector.shuffled()
            break
          case 'clampMax':
            selector = selector.clampMax(step.arg) as ChainableSelector<SelectorOpinion>
            break
          case 'clampMin':
            selector = selector.clampMin(step.arg) as ChainableSelector<SelectorOpinion>
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

function parseExtractor<T extends SelectorOpinion>(
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
    return dynamicExtractor(target)
  }
}

function parseCondition(dsl: ConditionDSL): ConditionOperator<SelectorOpinion> {
  switch (dsl.type) {
    case 'compare':
      return Conditions.compare(
        dsl.operator,
        parseValue(dsl.value) as ValueSource<number>,
      ) as ConditionOperator<SelectorOpinion>
    case 'same':
      return Conditions.same(
        parseValue(dsl.value) as ValueSource<number | string | boolean>,
      ) as ConditionOperator<SelectorOpinion>
    case 'any':
      // 递归解析嵌套条件（OR 逻辑）
      return Conditions.any(...dsl.conditions.map(v => parseCondition(v)))
    case 'all':
      // 递归解析嵌套条件（AND 逻辑）
      return Conditions.all(...dsl.conditions.map(v => parseCondition(v)))
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
  }
}

// Common value parser reused across actions [source_id: parse.ts]
function parseValue(v: Value): string | number | boolean | ChainableSelector<SelectorOpinion> {
  if (v.type === 'raw:number') return v.value as number
  if (v.type === 'raw:string') return v.value as string
  if (v.type === 'raw:boolean') return v.value as boolean
  if (v.type === 'raw:markId') return v.value as string
  return parseSelector(v.selector)
}

function isNumberValue(value: ValueSource<SelectorOpinion>): value is number {
  return typeof value === 'number'
}

function parseDamageAction(dsl: Extract<ActionDSL, { type: 'dealDamage' }>) {
  const value = parseValue(dsl.value)
  if (!isNumberValue(value)) {
    throw new Error('Damage value must be a number')
  }
  return parseSelector<Pet>(dsl.target).apply(Operators.dealDamage(parseValue(dsl.value) as ValueSource<number>))
}

function parseHealAction(dsl: Extract<ActionDSL, { type: 'heal' }>) {
  const selector = parseSelector<Pet>(dsl.target)
  return selector.apply(Operators.heal(parseValue(dsl.value) as ValueSource<number>))
}

function parseAddMarkAction(dsl: Extract<ActionDSL, { type: 'addMark' }>) {
  const selector = parseSelector<Pet>(dsl.target)
  const mark = DataRepository.getInstance().getMark(dsl.mark)
  return selector.apply(Operators.addMark(mark, dsl.duration))
}

// Pattern for stack-related actions [source_id: operator.ts]
function parseAddStacksAction(dsl: Extract<ActionDSL, { type: 'addStacks' }>) {
  return parseSelector<Mark>(dsl.target).apply(Operators.addStack(dsl.mark, dsl.value))
}

function parseConsumeStacksAction(dsl: Extract<ActionDSL, { type: 'consumeStacks' }>) {
  return parseSelector<Mark>(dsl.target).apply(Operators.consumeStacks(dsl.mark, dsl.value))
}

// Stat modification pattern [source_id: parse.ts]
function parseModifyStatAction(dsl: Extract<ActionDSL, { type: 'modifyStat' }>) {
  return parseSelector<Pet>(dsl.target).apply(
    Operators.modifyStat(
      parseValue(dsl.statType) as ValueSource<StatTypeOnBattle>,
      parseValue(dsl.value) as ValueSource<number>,
      parseValue(dsl.percent) as ValueSource<number>,
    ),
  )
}

function parseStatStageBuffAction(dsl: Extract<ActionDSL, { type: 'statStageBuff' }>) {
  return parseSelector<Pet>(dsl.target).apply(
    Operators.statStageBuff(
      parseValue(dsl.statType) as ValueSource<StatTypeWithoutHp>,
      parseValue(dsl.value) as ValueSource<number>,
    ),
  )
}

// Utility action handlers [source_id: operator.ts]
function parseAddRageAction(dsl: Extract<ActionDSL, { type: 'addRage' }>) {
  return parseSelector<Player>(dsl.target).apply(Operators.addRage(parseValue(dsl.value) as ValueSource<number>))
}

function parseAmplifyPowerAction(dsl: Extract<ActionDSL, { type: 'amplifyPower' }>) {
  return parseSelector<UseSkillContext>(dsl.target).apply(
    Operators.amplifyPower(parseValue(dsl.value) as ValueSource<number>),
  )
}

function parseAddPowerAction(dsl: Extract<ActionDSL, { type: 'addPower' }>) {
  return parseSelector<UseSkillContext>(dsl.target).apply(
    Operators.addPower(parseValue(dsl.value) as ValueSource<number>),
  )
}
