import {
  BaseSelector,
  ChainableSelector,
  createExtractor,
  Extractor,
  SelectorOpinion,
  ValueSource,
} from '@/effectBuilder/selector'
import { ActionDSL, SelectorDSL, ConditionDSL, Value } from './dsl'
import { Conditions } from '@/effectBuilder/condition'
import { Operators } from '@/effectBuilder/operator'
import { ConditionOperator } from '@/effectBuilder/effectBuilder'
import { DataRepository } from '@/daraRespository/dataRepository'

function parseSelector(dsl: SelectorDSL): ChainableSelector<SelectorOpinion> {
  let selector: ChainableSelector<SelectorOpinion>

  if (typeof dsl === 'string') {
    if (!(dsl in BaseSelector)) {
      throw new Error(`未知的基础选择器: ${dsl}`)
    }
    selector = BaseSelector[dsl as keyof typeof BaseSelector]
  } else {
    if (!(dsl.base in BaseSelector)) {
      throw new Error(`未知的基础选择器: ${dsl.base}`)
    }
    selector = BaseSelector[dsl.base as keyof typeof BaseSelector]

    // 处理链式操作
    for (const step of dsl.chain) {
      try {
        switch (step.type) {
          case 'select': {
            const extractor = parseExtractor(step.arg)
            selector = selector.select(extractor)
            break
          }
          case 'where': {
            const condition = parseCondition(step.arg)
            selector = selector.where(condition)
            break
          }
          case 'whereAttr': {
            const extractor = parseExtractor(step.extractor)
            const condition = parseCondition(step.condition)
            selector = selector.whereAttr(extractor, condition)
            break
          }
          case 'and': {
            const otherselector = parseSelector(step.arg).build()
            selector = selector.and(otherselector)
            break
          }
          case 'or': {
            const otherselector = parseSelector(step.arg).build()
            selector = selector.or(otherselector, step.duplicate ?? false)
            break
          }
          case 'randomPick':
            selector = selector.randomPick(step.arg)
            break
          case 'randomSample':
            selector = selector.randomSample(step.arg)
            break
          case 'sum':
            selector = selector.sum()
            break
          case 'add': {
            if (typeof step.arg === 'number') {
              selector = selector.add(step.arg)
              break
            }
            const otherselector = parseSelector(step.arg) as ChainableSelector<number>
            selector = selector.add(otherselector)
            break
          }
          case 'multiply': {
            if (typeof step.arg === 'number') {
              selector = selector.multiply(step.arg)
              break
            }
            const otherselector = parseSelector(step.arg) as ChainableSelector<number>
            selector = selector.multiply(otherselector)
            break
          }
          case 'divide': {
            if (typeof step.arg === 'number') {
              selector = selector.divide(step.arg)
              break
            }
            const otherselector = parseSelector(step.arg) as ChainableSelector<number>
            selector = selector.divide(otherselector)
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

  return selector as ChainableSelector<SelectorOpinion>
}

function parseExtractor(value: keyof typeof Extractor | string) {
  switch (value) {
    case 'hp':
      return Extractor.hp
    case 'maxhp':
      return Extractor.maxhp
    case 'rage':
      return Extractor.rage
    case 'owner':
      return Extractor.owner
    case 'type':
      return Extractor.type
    case 'marks':
      return Extractor.marks
    case 'stats':
      return Extractor.stats
    case 'stack':
      return Extractor.stack
    case 'duration':
      return Extractor.duration
    case 'power':
      return Extractor.power
    case 'priority':
      return Extractor.priority
    case 'activePet':
      return Extractor.activePet
    case 'skills':
      return Extractor.skills
    case 'id':
      return Extractor.id
    case 'tags':
      return Extractor.tags
  }
  return createExtractor(value)
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
  return parseSelector(dsl.target).apply(Operators.dealDamage(parseValue(dsl.value) as ValueSource<number>))
}

function parseHealAction(dsl: Extract<ActionDSL, { type: 'heal' }>) {
  const selector = parseSelector(dsl.target)
  return selector.apply(Operators.heal(parseValue(dsl.value)))
}

function parseAddMarkAction(dsl: Extract<ActionDSL, { type: 'addMark' }>) {
  const selector = parseSelector(dsl.target)
  const mark = DataRepository.getInstance().getMark(dsl.mark)
  return selector.apply(Operators.addMark(mark, parseValue(dsl.duration)))
}

// Pattern for stack-related actions [source_id: operator.ts]
function parseAddStacksAction(dsl: Extract<ActionDSL, { type: 'addStacks' }>) {
  return parseSelector(dsl.target).apply(Operators.addStack(dsl.mark, dsl.value))
}

function parseConsumeStacksAction(dsl: Extract<ActionDSL, { type: 'consumeStacks' }>) {
  return parseSelector(dsl.target).apply(Operators.consumeStacks(dsl.mark, dsl.value))
}

// Stat modification pattern [source_id: parse.ts]
function parseModifyStatAction(dsl: Extract<ActionDSL, { type: 'modifyStat' }>) {
  return parseSelector(dsl.target).apply(
    Operators.modifyStat(parseValue(dsl.statType), parseValue(dsl.value), parseValue(dsl.percent)),
  )
}

function parseStatStageBuffAction(dsl: Extract<ActionDSL, { type: 'statStageBuff' }>) {
  return parseSelector(dsl.target).apply(Operators.statStageBuff(parseValue(dsl.statType), parseValue(dsl.value)))
}

// Utility action handlers [source_id: operator.ts]
function parseAddRageAction(dsl: Extract<ActionDSL, { type: 'addRage' }>) {
  return parseSelector(dsl.target).apply(Operators.addRage(parseValue(dsl.value)))
}

function parseAmplifyPowerAction(dsl: Extract<ActionDSL, { type: 'amplifyPower' }>) {
  return parseSelector(dsl.target).apply(Operators.amplifyPower(parseValue(dsl.value)))
}

function parseAddPowerAction(dsl: Extract<ActionDSL, { type: 'addPower' }>) {
  return parseSelector(dsl.target).apply(Operators.addPower(parseValue(dsl.value) as ValueSource<number>))
}
