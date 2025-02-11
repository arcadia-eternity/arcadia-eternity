import {
  BaseSelector,
  ChainableSelector,
  createExtractor,
  Extractor,
  SelectorOpinion,
  ValueSource,
} from '@/effectBuilder/selector'
import { ActionDSL, SelectorDSL, ConditionDSL, Value, EffectTrigger } from './dsl'
import { EffectContext } from '@/core/context'
import { Conditions } from '@/effectBuilder/condition'
import { Operators } from '@/effectBuilder/operator'
import { ConditionOperator } from '@/effectBuilder/effectBuilder'

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
          case 'whereAttr':
          case 'and':
          case 'or':
          case 'randomPick':
          case 'randomSample':
          case 'sum':
          case 'add':
          case 'multiply':
          case 'divide':
          case 'shuffled':
          case 'clampMax':
          case 'clampMin':
          default:
            throw new Error(`未知的操作类型: ${(step as { type: string }).type}`)
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        throw new Error(`步骤[${step.type}]执行失败: ${error.message}`)
      }
    }
  }

  return selector
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
        parseValue(dsl.value) as ValueSource<string | number>,
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

function parseValue(v: Value): ValueSource<SelectorOpinion> {
  switch (v.type) {
    case 'raw':
      return v.value
    case 'dynamic':
      return parseSelector(v.selector).build()
  }
}

export function createAction(dsl: ActionDSL): (ctx: EffectContext<EffectTrigger>) => void {
  const operator = Operators[dsl.operator]
  const targetSelector = parseSelector(dsl.target)

  // 处理动态参数
  const args = dsl.args?.map(v => parseValue(v)) ?? []

  return targetSelector.apply(operator(...(args as Parameters<typeof operator>)))
}
