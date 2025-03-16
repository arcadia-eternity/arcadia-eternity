import {
  AddMarkContext,
  BaseMark,
  BaseSkill,
  type ConfigValue,
  DamageContext,
  Effect,
  EffectContext,
  HealContext,
  type MarkInstance,
  Pet,
  Player,
  type ScopeObject,
  SkillInstance,
  UpdateStatContext,
  UseSkillContext,
} from '@test-battle/battle'
import {
  type baseMarkId,
  type baseSkillId,
  type effectId,
  EffectTrigger,
  StackStrategy,
  type StatTypeOnBattle,
  StatTypeWithoutHp,
} from '@test-battle/const'
import { DataRepository } from '@test-battle/data-repository'
import {
  BaseSelector,
  type PathExtractor,
  ChainableSelector,
  type Condition,
  Evaluators,
  type Evaluator,
  Extractor,
  Operators,
  type SelectorOpinion,
  type ValueSource,
  createPathExtractor,
  Conditions,
  type Action,
  type PropertyRef,
  type PrimitiveOpinion,
  registerLiteralValue,
  type ConfigValueSource,
} from '@test-battle/effect-builder'
import { RuntimeTypeChecker } from '@test-battle/effect-builder/runtime-type-checker'
import type {
  OperatorDSL,
  ConditionDSL,
  EffectDSL,
  EvaluatorDSL,
  ExtractorDSL,
  SelectorChain,
  SelectorDSL,
  Value,
} from '@test-battle/schema'

export function parseEffect(dsl: EffectDSL): Effect<EffectTrigger> {
  try {
    const condition = dsl.condition ? parseCondition(dsl.id, dsl.condition) : undefined
    if (Array.isArray(dsl.apply)) {
      const actions = dsl.apply.map(a => createAction(dsl.id, a))
      return new Effect(dsl.id as effectId, dsl.trigger, actions, dsl.priority, condition, dsl.consumesStacks)
    } else {
      const actions = createAction(dsl.id, dsl.apply)
      return new Effect(dsl.id as effectId, dsl.trigger, actions, dsl.priority, condition, dsl.consumesStacks)
    }
  } catch (error) {
    console.log(`解析${dsl.id}时出现问题,`, error)
    throw error
  }
}

export function parseSelector<T extends SelectorOpinion>(effectId: string, dsl: SelectorDSL): ChainableSelector<T> {
  // 解析基础选择器
  const baseSelector = typeof dsl === 'string' ? getBaseSelector(dsl) : getBaseSelector(dsl.base)

  // 处理链式操作
  if (typeof dsl !== 'string' && dsl.chain) {
    return dsl.chain.reduce(
      (selector, step) => applySelectorStep(effectId, selector, step),
      baseSelector as ChainableSelector<SelectorOpinion>,
    ) as ChainableSelector<T>
  }

  return baseSelector as ChainableSelector<T>
}

function getBaseSelector(selectorKey: string): ChainableSelector<SelectorOpinion> {
  if (!(selectorKey in BaseSelector)) {
    throw new Error(`未知的基础选择器: ${selectorKey}`)
  }
  return BaseSelector[selectorKey as keyof typeof BaseSelector]
}

function applySelectorStep(
  effectId: string,
  selector: ChainableSelector<SelectorOpinion>,
  step: SelectorChain,
): ChainableSelector<SelectorOpinion> {
  try {
    switch (step.type) {
      case 'select': {
        // 解析提取器，可能为ChainableExtractor或ValueExtractor
        const extractor = parseExtractor(effectId, selector, step.arg)
        return selector.select(extractor)
      }
      case 'selectPath': {
        validatePath(selector, step.arg)
        return selector.selectPath(step.arg)
      }

      case 'selectProp': {
        if (process.env.NODE_ENV !== 'production') {
          validatePath(selector, step.arg)
        }

        return selector.selectProp(step.arg as keyof NonNullable<SelectorOpinion>) as ChainableSelector<SelectorOpinion>
      }

      case 'where':
        return selector.where(parseEvaluator(effectId, step.arg))

      case 'whereAttr': {
        const extractor = parseExtractor(effectId, selector, step.extractor)
        const condition = parseEvaluator(effectId, step.evaluator)
        return selector.whereAttr(extractor, condition)
      }

      case 'flat':
        return selector.flat()

      case 'and':
        return selector.and(parseSelector(effectId, step.arg).build())

      case 'or':
        return selector.or(parseSelector(effectId, step.arg).build(), step.duplicate ?? false)

      case 'randomPick':
        return selector.randomPick(parseValue(effectId, step.arg) as ValueSource<number>)

      case 'randomSample':
        return selector.randomSample(parseValue(effectId, step.arg) as ValueSource<number>)

      case 'sum': {
        assertNumberSelector(selector)
        return selector.sum()
      }

      case 'add': {
        assertNumberSelector(selector)
        return selector.add(parseValue(effectId, step.arg) as ValueSource<number>)
      }

      case 'multiply': {
        assertNumberSelector(selector)
        return selector.multiply(parseValue(effectId, step.arg) as ValueSource<number>)
      }

      case 'divide': {
        assertNumberSelector(selector)
        if (
          !Array.isArray(step.arg) &&
          typeof step.arg === 'object' &&
          step.arg.type === 'raw:number' &&
          step.arg.value === 0
        ) {
          throw new Error('除数不能为0')
        }
        return selector.divide(parseValue(effectId, step.arg) as ValueSource<number>)
      }

      case 'shuffled':
        return selector.shuffled()

      case 'limit':
        return selector.limit(parseValue(effectId, step.arg) as ValueSource<number>)

      case 'clampMax': {
        assertNumberSelector(selector)
        return selector.clampMax(parseValue(effectId, step.arg) as ValueSource<number>)
      }

      case 'clampMin': {
        assertNumberSelector(selector)
        return selector.clampMax(parseValue(effectId, step.arg) as ValueSource<number>)
      }

      default:
        throw new Error(`未知的操作类型: ${(step as any).type}`)
    }
  } catch (e) {
    throw new Error(`步骤[${step.type}]执行失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function assertNumberSelector(
  selector: ChainableSelector<SelectorOpinion>,
): asserts selector is ChainableSelector<number> {
  if (!selector.isNumberType()) {
    throw new Error(`数值操作需要选择器返回数字类型，当前类型为 ${selector.type}`)
  }
}

export function parseExtractor(
  effectId: string,
  selector: ChainableSelector<SelectorOpinion>,
  dsl: ExtractorDSL,
): PathExtractor<SelectorOpinion, SelectorOpinion> {
  if (typeof dsl === 'string') {
    if (Object.keys(Extractor).includes(dsl)) return Extractor[dsl] as PathExtractor<SelectorOpinion, SelectorOpinion>
    else throw Error('未知的提取器')
  }
  switch (dsl.type) {
    case 'base':
      return Extractor[dsl.arg] as PathExtractor<SelectorOpinion, SelectorOpinion>
    case 'dynamic':
      return createPathExtractor(selector.type, dsl.arg)
    default:
      throw Error('未知的提取器')
  }
}

function parseEvaluator(effectId: string, dsl: EvaluatorDSL): Evaluator<SelectorOpinion> {
  switch (dsl.type) {
    case 'compare':
      return Evaluators.compare(
        dsl.operator,
        parseValue(effectId, dsl.value) as ValueSource<number>,
      ) as Evaluator<SelectorOpinion>
    case 'same':
      return Evaluators.same(
        parseValue(effectId, dsl.value) as ValueSource<number | string | boolean>,
      ) as Evaluator<SelectorOpinion>
    case 'notSame':
      return Evaluators.notSame(
        parseValue(effectId, dsl.value) as ValueSource<number | string | boolean>,
      ) as Evaluator<SelectorOpinion>
    case 'any':
      // 递归解析嵌套条件（OR 逻辑）
      return Evaluators.any(...dsl.conditions.map(v => parseEvaluator(effectId, v)))
    case 'all':
      // 递归解析嵌套条件（AND 逻辑）
      return Evaluators.all(...dsl.conditions.map(v => parseEvaluator(effectId, v)))
    case 'not':
      return Evaluators.not(parseEvaluator(effectId, dsl.condition))
    case 'probability':
      return Evaluators.probability(parseValue(effectId, dsl.percent) as ValueSource<number>)
    case 'contain':
      return Evaluators.contain(dsl.tag) as Evaluator<SelectorOpinion>
    case 'exist':
      return Evaluators.exist()
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown condition type: ${(dsl as any).type}`)
    }
  }
}

export function createAction(effectId: string, dsl: OperatorDSL) {
  switch (dsl.type) {
    case 'dealDamage':
      return parseDamageAction(effectId, dsl)
    case 'heal':
      return parseHealAction(effectId, dsl)
    case 'addMark':
      return parseAddMarkAction(effectId, dsl)
    case 'addStacks':
      return parseAddStacksAction(effectId, dsl)
    case 'consumeStacks':
      return parseConsumeStacksAction(effectId, dsl)
    case 'modifyStat':
      return parseModifyStatAction(effectId, dsl)
    case 'statStageBuff':
      return parseStatStageBuffAction(effectId, dsl)
    case 'clearStatStage':
      return parseClearStatStage(effectId, dsl)
    case 'addRage':
      return parseAddRageAction(effectId, dsl)
    case 'amplifyPower':
      return parseAmplifyPowerAction(effectId, dsl)
    case 'addPower':
      return parseAddPowerAction(effectId, dsl)
    case 'addCritRate':
      return parseAddCritRate(effectId, dsl)
    case 'addMultihitResult':
      return parseAddMultihitResult(effectId, dsl)
    case 'transferMark':
      return parseTransferMark(effectId, dsl)
    case 'stun':
      return parseStunAction(effectId, dsl)
    case 'setSureHit':
      return parseSetSureHitAction(effectId, dsl)
    case 'setSureCrit':
      return parseSetSureCritAction(effectId, dsl)
    case 'setSureMiss':
      return parseSetSureMissAction(effectId, dsl)
    case 'setSureNoCrit':
      return parseSetSureNoCritAction(effectId, dsl)
    case 'destroyMark':
      return parseDestroyMarkAction(effectId, dsl)
    case 'setSkill':
      return parseSetSkill(effectId, dsl)
    case 'preventDamage':
      return parsePreventDamage(effectId, dsl)
    case 'setActualTarget':
      return parseSetActualTarget(effectId, dsl)
    case 'addModified':
      return parseAddModified(effectId, dsl)
    case 'addThreshold':
      return parseAddThresholdAction(effectId, dsl)
    case 'overrideMarkConfig':
      return parseOverrideMarkConfig(effectId, dsl)
    case 'setMarkDuration':
      return parseSetMarkDuration(effectId, dsl)
    case 'setMarkStack':
      return parseSetMarkStack(effectId, dsl)
    case 'setMarkMaxStack':
      return parseSetMarkMaxStack(effectId, dsl)
    case 'setMarkPersistent':
      return parseSetMarkPersistent(effectId, dsl)
    case 'setMarkStackable':
      return parseSetMarkStackable(effectId, dsl)
    case 'setMarkStackStrategy':
      return parseSetMarkStackStrategy(effectId, dsl)
    case 'setMarkDestroyable':
      return parseSetMarkDestroyable(effectId, dsl)
    case 'setMarkIsShield':
      return parseSetMarkIsShield(effectId, dsl)
    case 'setMarkKeepOnSwitchOut':
      return parseSetMarkKeepOnSwitchOut(effectId, dsl)
    case 'setMarkTransferOnSwitch':
      return parseSetMarkTransferOnSwitch(effectId, dsl)
    case 'setMarkInheritOnFaint':
      return parseSetMarkInheritOnFaint(effectId, dsl)
    case 'addValue':
      return parseAddValue(effectId, dsl)
    case 'setValue':
      return parseSetValue(effectId, dsl)
    case 'toggle':
      return parseToggle(effectId, dsl)
    case 'setConfig':
      return parseSetconfig(effectId, dsl)
  }
}

// Common value parser reused across actions [source_id: parse.ts]
export function parseValue(effectId: string, v: Value): string | number | boolean | ValueSource<SelectorOpinion> {
  if (Array.isArray(v)) return v.map(value => parseValue(effectId, value))
  if (typeof v === 'string') return v
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v
  if (v.type === 'raw:number') {
    const fullKey = registerLiteralValue(effectId, v.value, v.configId)
    return { configId: fullKey, defaultValue: v.value } as ConfigValueSource<number>
  }
  if (v.type === 'raw:string') {
    const fullKey = registerLiteralValue(effectId, v.value, v.configId)
    return { configId: fullKey, defaultValue: v.value } as ConfigValueSource<string>
  }
  if (v.type === 'raw:boolean') {
    const fullKey = registerLiteralValue(effectId, v.value, v.configId)
    return { configId: fullKey, defaultValue: v.value } as ConfigValueSource<boolean>
  }
  if (v.type === 'entity:baseMark')
    return (() => [DataRepository.getInstance().getMark(v.value as baseMarkId)]) as ValueSource<BaseMark>
  if (v.type === 'entity:baseSkill')
    return (() => [DataRepository.getInstance().getSkill(v.value as baseSkillId)]) as ValueSource<BaseSkill>
  if (v.type === 'dynamic') return parseSelector(effectId, v.selector)
  throw Error('未知的数值类型')
}

export function isNumberValue(value: ValueSource<SelectorOpinion>): value is number {
  return typeof value === 'number'
}

export function parseDamageAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'dealDamage' }>) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.dealDamage(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseHealAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'heal' }>) {
  const selector = parseSelector<Pet>(effectId, dsl.target)
  return selector.apply(Operators.heal(parseValue(effectId, dsl.value) as ValueSource<number>))
}

export function parseAddMarkAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'addMark' }>) {
  const selector = parseSelector<Pet>(effectId, dsl.target)
  const mark = parseValue(effectId, dsl.mark) as ValueSource<BaseMark>
  const duration = dsl.duration ? (parseValue(effectId, dsl.duration) as ValueSource<number>) : undefined
  const stack = dsl.stack ? (parseValue(effectId, dsl.stack) as ValueSource<number>) : undefined
  return selector.apply(Operators.addMark(mark, stack, duration))
}

// Pattern for stack-related actions [source_id: operator.ts]
export function parseAddStacksAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'addStacks' }>) {
  return parseSelector<MarkInstance>(effectId, dsl.target).apply(
    Operators.addStack(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseConsumeStacksAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'consumeStacks' }>) {
  return parseSelector<MarkInstance>(effectId, dsl.target).apply(
    Operators.consumeStacks(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

// Stat modification pattern [source_id: parse.ts]
export function parseModifyStatAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'modifyStat' }>) {
  return parseSelector<UpdateStatContext>(effectId, dsl.target).apply(
    Operators.modifyStat(
      parseValue(effectId, dsl.statType) as ValueSource<StatTypeOnBattle>,
      parseValue(effectId, dsl.delta ?? 0) as ValueSource<number>,
      parseValue(effectId, dsl.percent ?? 0) as ValueSource<number>,
    ),
  )
}

export function parseStatStageBuffAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'statStageBuff' }>) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.statStageBuff(
      parseValue(effectId, dsl.statType) as ValueSource<StatTypeWithoutHp>,
      parseValue(effectId, dsl.value) as ValueSource<number>,
    ),
  )
}

export function parseClearStatStage(effectId: string, dsl: Extract<OperatorDSL, { type: 'clearStatStage' }>) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.clearStatStage(
      dsl.statType ? (parseValue(effectId, dsl.statType) as ValueSource<StatTypeWithoutHp>) : undefined,
    ),
  )
}

// Utility action handlers [source_id: operator.ts]
export function parseAddRageAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'addRage' }>) {
  return parseSelector<Player>(effectId, dsl.target).apply(
    Operators.addRage(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseAmplifyPowerAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'amplifyPower' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.amplifyPower(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseAddPowerAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'addPower' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.addPower(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseAddCritRate(effectId: string, dsl: Extract<OperatorDSL, { type: 'addCritRate' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.addCritRate(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseAddMultihitResult(effectId: string, dsl: Extract<OperatorDSL, { type: 'addMultihitResult' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.addMultihitResult(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseStunAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'stun' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(Operators.stun())
}

export function parseTransferMark(effectId: string, dsl: Extract<OperatorDSL, { type: 'transferMark' }>) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.transferMark(parseValue(effectId, dsl.mark) as ValueSource<MarkInstance>),
  )
}

export function parseSetSureHitAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'setSureHit' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(Operators.setSureHit(dsl.priority))
}

export function parseSetSureCritAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'setSureCrit' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(Operators.setSureCrit(dsl.priority))
}

export function parseSetSureMissAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'setSureMiss' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(Operators.setSureMiss(dsl.priority))
}

export function parseSetSureNoCritAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'setSureNoCrit' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(Operators.setSureNoCrit(dsl.priority))
}

export function parseDestroyMarkAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'destroyMark' }>) {
  return parseSelector<MarkInstance>(effectId, dsl.target).apply(Operators.destroyMark())
}

export function parseSetSkill(effectId: string, dsl: Extract<OperatorDSL, { type: 'setSkill' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.setSkill(parseValue(effectId, dsl.value) as ValueSource<SkillInstance>),
  )
}

export function parsePreventDamage(effectId: string, dsl: Extract<OperatorDSL, { type: 'preventDamage' }>) {
  return parseSelector<DamageContext>(effectId, dsl.target).apply(Operators.preventDamage())
}

export function parseSetActualTarget(effectId: string, dsl: Extract<OperatorDSL, { type: 'setActualTarget' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.setActualTarget(parseValue(effectId, dsl.newTarget) as ValueSource<Pet>),
  )
}

export function parseAddModified(effectId: string, dsl: Extract<OperatorDSL, { type: 'addModified' }>) {
  return parseSelector<DamageContext | HealContext>(effectId, dsl.target).apply(
    Operators.addModified(
      parseValue(effectId, dsl.percent) as ValueSource<number>,
      parseValue(effectId, dsl.delta) as ValueSource<number>,
    ),
  )
}

export function parseAddThresholdAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'addThreshold' }>) {
  const min = dsl.min ? (parseValue(effectId, dsl.min) as ValueSource<number>) : undefined
  const max = dsl.max ? (parseValue(effectId, dsl.max) as ValueSource<number>) : undefined
  return parseSelector<DamageContext>(effectId, dsl.target).apply(Operators.addThreshold(min, max))
}

export function parseOverrideMarkConfig(effectId: string, dsl: Extract<OperatorDSL, { type: 'overrideMarkConfig' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(Operators.overrideMarkConfig(dsl.config))
}

export function parseSetMarkDuration(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkDuration' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkDuration(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseSetMarkStack(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkStack' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkStack(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseSetMarkMaxStack(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkMaxStack' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkMaxStack(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

export function parseSetMarkPersistent(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkPersistent' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkPersistent(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

export function parseSetMarkStackable(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkStackable' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkStackable(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

export function parseSetMarkStackStrategy(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'setMarkStackStrategy' }>,
) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkStackStrategy(parseValue(effectId, dsl.value) as ValueSource<StackStrategy>),
  )
}

export function parseSetMarkDestroyable(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkDestroyable' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkDestroyable(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

export function parseSetMarkIsShield(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMarkIsShield' }>) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkIsShield(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

export function parseSetMarkKeepOnSwitchOut(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'setMarkKeepOnSwitchOut' }>,
) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkKeepOnSwitchOut(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

export function parseSetMarkTransferOnSwitch(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'setMarkTransferOnSwitch' }>,
) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkTransferOnSwitch(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

export function parseSetMarkInheritOnFaint(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'setMarkInheritOnFaint' }>,
) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setMarkInheritOnFaint(parseValue(effectId, dsl.value) as ValueSource<boolean>),
  )
}

function parseAddValue(effectId: string, dsl: Extract<OperatorDSL, { type: 'addValue' }>) {
  return parseSelector<PropertyRef<any, number>>(effectId, dsl.target).apply(
    Operators.addValue(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

function parseSetValue(effectId: string, dsl: Extract<OperatorDSL, { type: 'setValue' }>) {
  return parseSelector<PropertyRef<any, PrimitiveOpinion>>(effectId, dsl.target).apply(
    Operators.setValue(parseValue(effectId, dsl.value) as ValueSource<PrimitiveOpinion>),
  )
}

function parseToggle(effectId: string, dsl: Extract<OperatorDSL, { type: 'toggle' }>) {
  return parseSelector<PropertyRef<any, boolean>>(effectId, dsl.target).apply(Operators.toggle())
}

function parseSetconfig(effectId: string, dsl: Extract<OperatorDSL, { type: 'setConfig' }>) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.setConfig(
      parseValue(effectId, dsl.key) as ValueSource<string>,
      parseValue(effectId, dsl.value) as ValueSource<ConfigValue>,
    ),
  )
}

export function parseCondition(effectId: string, dsl: ConditionDSL): Condition {
  switch (dsl.type) {
    case 'evaluate':
      return parseEvaluateCondition(effectId, dsl)
    case 'some':
      return parseSomeCondition(effectId, dsl)
    case 'every':
      return parseEveryCondition(effectId, dsl)
    case 'not':
      return parseNotCondition(effectId, dsl)
    case 'petIsActive':
      return Conditions.petIsActive()
    case 'selfUseSkill':
      return Conditions.selfUseSkill()
    case 'checkSelf':
      return Conditions.checkSelf()
    case 'foeUseSkill':
      return Conditions.foeUseSkill()
    case 'selfBeDamaged':
      return Conditions.selfBeDamaged()
    case 'selfAddMark':
      return Conditions.selfAddMark()
    case 'foeAddMark':
      return Conditions.foeAddMark()
    case 'selfBeAddMark':
      return Conditions.selfBeAddMark()
    case 'foeBeAddMark':
      return Conditions.foeBeAddMark()
    case 'selfBeHeal':
      return Conditions.selfBeHeal()
  }
}

export function parseEvaluateCondition(effectId: string, dsl: Extract<ConditionDSL, { type: 'evaluate' }>): Condition {
  const target = parseSelector(effectId, dsl.target)
  const evaluator = parseEvaluator(effectId, dsl.evaluator)
  return target.condition(evaluator)
}

export function parseSomeCondition(effectId: string, dsl: Extract<ConditionDSL, { type: 'some' }>): Condition {
  return Conditions.some(...dsl.conditions.map(v => parseCondition(effectId, v)))
}

export function parseEveryCondition(effectId: string, dsl: Extract<ConditionDSL, { type: 'every' }>): Condition {
  return Conditions.every(...dsl.conditions.map(v => parseCondition(effectId, v)))
}

export function parseNotCondition(effectId: string, dsl: Extract<ConditionDSL, { type: 'not' }>): Condition {
  return Conditions.not(parseCondition(effectId, dsl.condition))
}

function validatePath(selector: ChainableSelector<SelectorOpinion>, path: string) {
  if (!RuntimeTypeChecker.validatePath(selector.type, path)) {
    const expected = RuntimeTypeChecker.getExpectedType(selector.type, path)
    throw new Error(`[路径校验失败] 路径 '${path}' 在类型 ${selector.type} 中不存在\n预期类型: ${expected}`)
  }
}
