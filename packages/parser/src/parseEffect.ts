import {
  AddMarkContext,
  BaseMark,
  BaseSkill,
  type BattlePhaseBase,
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
  StackContext,
  SwitchPetContext,
  UseSkillContext,
  Battle,
} from '@arcadia-eternity/battle'
import { Observable } from 'rxjs'
import {
  type baseMarkId,
  type baseSkillId,
  type effectId,
  EffectTrigger,
  IgnoreStageStrategy,
  type speciesId,
  StackStrategy,
  type StatTypeOnBattle,
  StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import { DataRepository } from '@arcadia-eternity/data-repository'
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
  type PropertyRef,
  type PrimitiveOpinion,
  registerLiteralValue,
  type ConfigValueSource,
  type ConditionalValueSource,
} from '@arcadia-eternity/effect-builder'
import { RuntimeTypeChecker } from '@arcadia-eternity/effect-builder'
import type {
  OperatorDSL,
  ConditionDSL,
  EffectDSL,
  EvaluatorDSL,
  ExtractorDSL,
  SelectorChain,
  SelectorDSL,
  Value,
  ChainSelector,
  SelectorValue,
} from '@arcadia-eternity/schema'

export function parseEffect(dsl: EffectDSL): Effect<EffectTrigger> {
  try {
    const condition = dsl.condition ? parseCondition(dsl.id, dsl.condition) : undefined

    let actions: any[]
    if (Array.isArray(dsl.apply)) {
      actions = dsl.apply.map(a => createAction(dsl.id, a))
    } else {
      actions = [createAction(dsl.id, dsl.apply)]
    }

    // Return effect with all actions (including registerConfig actions if needed)
    const triggers = Array.isArray(dsl.trigger) ? dsl.trigger : [dsl.trigger]
    if (Array.isArray(dsl.apply)) {
      return new Effect(dsl.id as effectId, triggers, actions, dsl.priority, condition, dsl.consumesStacks)
    } else {
      return new Effect(
        dsl.id as effectId,
        triggers,
        actions.length === 1 ? actions[0] : actions,
        dsl.priority,
        condition,
        dsl.consumesStacks,
        dsl.tags,
      )
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`[parseEffect] 解析效果 '${dsl.id}' 时出现问题: ${errorMessage}`)
  }
}

export function parseSelector<T extends SelectorOpinion>(effectId: string, dsl: SelectorDSL): ChainableSelector<T> {
  if (typeof dsl === 'object' && 'condition' in dsl) {
    const condition = parseCondition(effectId, dsl.condition)
    const trueSelector = parseSelector(effectId, dsl.trueSelector)
    const falseSelector = dsl.falseSelector ? parseSelector(effectId, dsl.falseSelector) : undefined
    return trueSelector.when(condition, trueSelector.build(), falseSelector?.build()) as ChainableSelector<T>
  }

  // 处理SelectorValue类型
  if (typeof dsl === 'object' && 'type' in dsl && dsl.type === 'selector') {
    const selectorValue = dsl as SelectorValue
    // 从Value创建selector
    const valueSelector = createSelectorFromValue(effectId, selectorValue.value)

    // 处理链式操作
    if (selectorValue.chain) {
      return selectorValue.chain.reduce(
        (selector, step) => applySelectorStep(effectId, selector, step),
        valueSelector as ChainableSelector<SelectorOpinion>,
      ) as ChainableSelector<T>
    }

    return valueSelector as ChainableSelector<T>
  }

  // 解析基础选择器
  const baseSelector = typeof dsl === 'string' ? getBaseSelector(dsl) : getBaseSelector((dsl as ChainSelector).base)

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
    throw new Error(`[parseEffect] 未知的基础选择器: ${selectorKey}`)
  }
  return BaseSelector[selectorKey as keyof typeof BaseSelector]
}

function createSelectorFromValue(effectId: string, value: Value): ChainableSelector<SelectorOpinion> {
  // 将Value转换为ValueSource
  const valueSource = parseValue(effectId, value)

  // 创建一个selector，它返回从Value解析出的值
  return new ChainableSelector<SelectorOpinion>(
    context => {
      if (typeof valueSource === 'function') {
        // 如果是函数（selector），直接调用
        return (valueSource as any)(context)
      } else if (valueSource instanceof ChainableSelector) {
        // 如果是ChainableSelector，调用其build方法
        return valueSource.build()(context)
      } else if (Array.isArray(valueSource)) {
        // 如果是数组，递归处理每个元素
        return valueSource.flatMap(item => {
          if (typeof item === 'function') {
            return (item as any)(context)
          } else if (item instanceof ChainableSelector) {
            return item.build()(context)
          } else {
            return [item]
          }
        })
      } else {
        // 原始值，包装成数组
        return [valueSource]
      }
    },
    'any', // 初始类型为any，后续可以通过链式操作推断
  )
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
        return selector.clampMin(parseValue(effectId, step.arg) as ValueSource<number>)
      }

      case 'configGet':
        return (selector as ChainableSelector<ScopeObject>).configGet(
          parseValue(effectId, step.key) as ValueSource<string>,
        ) as ChainableSelector<SelectorOpinion>

      case 'selectObservable':
        return (selector as any).selectObservable(step.arg) as ChainableSelector<SelectorOpinion>

      case 'selectAttribute$':
        return selector.selectAttribute$(step.arg) as ChainableSelector<SelectorOpinion>
      case 'asStatLevelMark':
        return selector.asStatLevelMark() as ChainableSelector<SelectorOpinion>

      case 'when':
        return selector.when(
          parseCondition(effectId, step.condition),
          parseValue(effectId, step.trueValue),
          step.falseValue ? parseValue(effectId, step.falseValue) : undefined,
        )

      default:
        throw new Error(`[parseEffect] 未知的选择器操作类型: ${(step as any).type}`)
    }
  } catch (e) {
    throw new Error(`[parseEffect] 选择器步骤 '${step.type}' 执行失败: ${e instanceof Error ? e.message : String(e)}`)
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
    else throw new Error(`[parseEffect] 未知的提取器: ${dsl}`)
  }
  switch (dsl.type) {
    case 'base':
      return Extractor[dsl.arg] as PathExtractor<SelectorOpinion, SelectorOpinion>
    case 'dynamic':
      return createPathExtractor(selector.type, dsl.arg)
    default:
      throw new Error(`[parseEffect] 未知的提取器类型: ${(dsl as any).type}`)
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
      throw new Error(`[parseEffect] 未知的评估器类型: ${(dsl as any).type}`)
    }
  }
}

export function createAction(effectId: string, dsl: OperatorDSL) {
  switch (dsl.type) {
    case 'TODO':
      return () => {}
    case 'conditional': {
      const condition = parseCondition(effectId, dsl.condition)
      const trueAction = createAction(effectId, dsl.trueOperator)
      const falseAction = dsl.falseOperator ? createAction(effectId, dsl.falseOperator) : undefined
      return (ctx: EffectContext<EffectTrigger>) => {
        if (condition(ctx)) {
          console.log('true')
          trueAction(ctx)
        } else if (falseAction) {
          console.log('false')
          falseAction(ctx)
        }
      }
    }
    case 'dealDamage':
      return parseDamageAction(effectId, dsl)
    case 'heal':
      return parseHealAction(effectId, dsl)
    case 'executeKill':
      return parseExecuteKillAction(effectId, dsl)
    case 'addMark':
      return parseAddMarkAction(effectId, dsl)
    case 'addStacks':
      return parseAddStacksAction(effectId, dsl)
    case 'consumeStacks':
      return parseConsumeStacksAction(effectId, dsl)
    case 'modifyStat':
      return parseModifyStatAction(effectId, dsl)
    case 'addAttributeModifier':
      return parseAddAttributeModifierAction(effectId, dsl)
    case 'addDynamicAttributeModifier':
      return parseAddDynamicAttributeModifierAction(effectId, dsl)
    case 'addClampMaxModifier':
      return parseAddClampMaxModifierAction(effectId, dsl)
    case 'addClampMinModifier':
      return parseAddClampMinModifierAction(effectId, dsl)
    case 'addClampModifier':
      return parseAddClampModifierAction(effectId, dsl)
    case 'addSkillAttributeModifier':
      return parseAddSkillAttributeModifierAction(effectId, dsl)
    case 'addDynamicSkillAttributeModifier':
      return parseAddDynamicSkillAttributeModifierAction(effectId, dsl)
    case 'addSkillClampMaxModifier':
      return parseAddSkillClampMaxModifierAction(effectId, dsl)
    case 'addSkillClampMinModifier':
      return parseAddSkillClampMinModifierAction(effectId, dsl)
    case 'addSkillClampModifier':
      return parseAddSkillClampModifierAction(effectId, dsl)
    case 'statStageBuff':
      return parseStatStageBuffAction(effectId, dsl)
    case 'clearStatStage':
      return parseClearStatStage(effectId, dsl)
    case 'transferStatStage':
      return parseTransferStatStage(effectId, dsl)
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
    case 'setMultihit':
      return parseSetMultihit(effectId, dsl)
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
    case 'modifyStackResult':
      return parseModifyStackResultAction(effectId, dsl)
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
    case 'setStatLevelMarkLevel':
      return parseSetStatLevelMarkLevel(effectId, dsl)
    case 'addValue':
      return parseAddValue(effectId, dsl)
    case 'setValue':
      return parseSetValue(effectId, dsl)
    case 'toggle':
      return parseToggle(effectId, dsl)
    case 'setConfig':
      return parseSetconfig(effectId, dsl)
    case 'setIgnoreStageStrategy':
      return parseSetIgnoreStageStrategy(effectId, dsl)
    case 'addAccuracy':
      return parseAddAccuracy(effectId, dsl)
    case 'setAccuracy':
      return parseSetAccuracy(effectId, dsl)
    case 'disableContext':
      return parseDisableContext(effectId, dsl)
    case 'addConfigModifier':
      return parseAddConfigModifierAction(effectId, dsl)
    case 'addDynamicConfigModifier':
      return parseAddDynamicConfigModifierAction(effectId, dsl)
    case 'registerConfig':
      return parseRegisterConfigAction(effectId, dsl)
    case 'registerTaggedConfig':
      return parseRegisterTaggedConfigAction(effectId, dsl)
    case 'addTaggedConfigModifier':
      return parseAddTaggedConfigModifierAction(effectId, dsl)
    case 'addPhaseConfigModifier':
      return parseAddPhaseConfigModifierAction(effectId, dsl)
    case 'addPhaseDynamicConfigModifier':
      return parseAddPhaseDynamicConfigModifierAction(effectId, dsl)
    case 'addPhaseTypeConfigModifier':
      return parseAddPhaseTypeConfigModifierAction(effectId, dsl)
    case 'addDynamicPhaseTypeConfigModifier':
      return parseAddDynamicPhaseTypeConfigModifierAction(effectId, dsl)
    case 'transform':
      return parseTransformAction(effectId, dsl)
    case 'transformWithPreservation':
      return parseTransformWithPreservationAction(effectId, dsl)
    case 'removeTransformation':
      return parseRemoveTransformationAction(effectId, dsl)
    default:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`[parseEffect] 未知的操作类型: ${(dsl as any).type}`)
  }
}

// Common value parser reused across actions [source_id: parse.ts]
export function parseValue(effectId: string, v: Value): string | number | boolean | ValueSource<SelectorOpinion> {
  if (Array.isArray(v)) return v.map(value => parseValue(effectId, value))
  if (typeof v === 'string') return v
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v
  if (typeof v === 'object' && 'type' in v && v.type === 'conditional') {
    const condition = parseCondition(effectId, v.condition)
    const trueValue = parseValue(effectId, v.trueValue)
    const falseValue = v.falseValue ? parseValue(effectId, v.falseValue) : undefined
    return {
      condition,
      trueValue,
      falseValue,
    } as ConditionalValueSource<SelectorOpinion>
  }
  if (v.type === 'raw:number' || v.type === 'raw:string' || v.type === 'raw:boolean') {
    if (v.configId) {
      const fullKey = registerLiteralValue(effectId, v.value, v.configId, v.tags)
      return { configId: fullKey, defaultValue: v.value } as ConfigValueSource<number>
    } else {
      // Use registerLiteralValue for internal temporary values
      const fullKey = registerLiteralValue(effectId, v.value, undefined, v.tags)
      return { configId: fullKey, defaultValue: v.value } as ConfigValueSource<number>
    }
  }
  if (v.type === 'entity:baseMark')
    return (() => [DataRepository.getInstance().getMark(v.value as baseMarkId)]) as ValueSource<BaseMark>
  if (v.type === 'entity:baseSkill')
    return (() => [DataRepository.getInstance().getSkill(v.value as baseSkillId)]) as ValueSource<BaseSkill>
  if (v.type === 'entity:species')
    return (() => [DataRepository.getInstance().getSpecies(v.value as speciesId)]) as ValueSource<any>
  if (v.type === 'dynamic') return parseSelector(effectId, v.selector)
  if (v.type === 'selector') return parseSelector(effectId, v)
  throw new Error(`[parseEffect] 未知的数值类型: ${(v as any).type}`)
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

export function parseExecuteKillAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'executeKill' }>) {
  const selector = parseSelector<Pet>(effectId, dsl.target)
  return selector.apply(Operators.executeKill())
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
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.modifyStat(
      parseValue(effectId, dsl.statType) as ValueSource<StatTypeOnBattle>,
      parseValue(effectId, dsl.percent ?? 0) as ValueSource<number>,
      parseValue(effectId, dsl.delta ?? 0) as ValueSource<number>,
    ),
  )
}

// Enhanced attribute modifier pattern with phase-aware support
export function parseAddAttributeModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addAttributeModifier' }>,
) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.addAttributeModifier(
      parseValue(effectId, dsl.stat) as ValueSource<StatTypeOnBattle>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'percent' | 'delta' | 'override'>,
      parseValue(effectId, dsl.value) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      // 🆕 Phase-aware parameters
      dsl.phaseType
        ? (parseValue(effectId, dsl.phaseType) as ValueSource<
            'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
          >)
        : undefined,
      dsl.scope ? (parseValue(effectId, dsl.scope) as ValueSource<'current' | 'any' | 'next'>) : undefined,
      dsl.phaseId ? (parseValue(effectId, dsl.phaseId) as ValueSource<string>) : undefined,
    ),
  )
}

// Enhanced dynamic attribute modifier pattern with phase-aware support
export function parseAddDynamicAttributeModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addDynamicAttributeModifier' }>,
) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.addDynamicAttributeModifier(
      parseValue(effectId, dsl.stat) as ValueSource<StatTypeOnBattle>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'percent' | 'delta' | 'override'>,
      parseSelector(effectId, dsl.observableValue) as ValueSource<Observable<number>>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      // 🆕 Phase-aware parameters
      dsl.phaseType
        ? (parseValue(effectId, dsl.phaseType) as ValueSource<
            'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
          >)
        : undefined,
      dsl.scope ? (parseValue(effectId, dsl.scope) as ValueSource<'current' | 'any' | 'next'>) : undefined,
      dsl.phaseId ? (parseValue(effectId, dsl.phaseId) as ValueSource<string>) : undefined,
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
      dsl.cleanStageStrategy,
    ),
  )
}

export function parseTransferStatStage(effectId: string, dsl: Extract<OperatorDSL, { type: 'transferStatStage' }>) {
  return parseSelector<Pet>(effectId, 'self').apply(
    Operators.transferStatStage(
      parseSelector<Pet>(effectId, dsl.source) as ValueSource<Pet>,
      parseSelector<Pet>(effectId, dsl.target) as ValueSource<Pet>,
      dsl.cleanStageStrategy,
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

export function parseSetMultihit(effectId: string, dsl: Extract<OperatorDSL, { type: 'setMultihit' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.setMultihit(parseValue(effectId, dsl.value) as ValueSource<number | [number, number]>),
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

export function parseModifyStackResultAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'modifyStackResult' }>,
) {
  const newStacks = dsl.newStacks ? (parseValue(effectId, dsl.newStacks) as ValueSource<number>) : undefined
  const newDuration = dsl.newDuration ? (parseValue(effectId, dsl.newDuration) as ValueSource<number>) : undefined
  return parseSelector<StackContext>(effectId, dsl.target).apply(Operators.modifyStackResult(newStacks, newDuration))
}

export function parseSetSkill(effectId: string, dsl: Extract<OperatorDSL, { type: 'setSkill' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.setSkill(parseValue(effectId, dsl.value) as ValueSource<SkillInstance>, dsl.updateConfig),
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

export function parseSetStatLevelMarkLevel(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'setStatLevelMarkLevel' }>,
) {
  return parseSelector<AddMarkContext>(effectId, dsl.target).apply(
    Operators.setStatLevelMarkLevel(parseValue(effectId, dsl.value) as ValueSource<number>),
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
  return parseSelector<Battle>(effectId, dsl.target).apply(
    Operators.setConfig(
      parseValue(effectId, dsl.key) as ValueSource<string>,
      parseValue(effectId, dsl.value) as ValueSource<ConfigValue>,
    ),
  )
}

function parseSetIgnoreStageStrategy(effectId: string, dsl: Extract<OperatorDSL, { type: 'setIgnoreStageStrategy' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.setIgnoreStageStrategy(parseValue(effectId, dsl.value) as ValueSource<IgnoreStageStrategy>),
  )
}

function parseAddAccuracy(effectId: string, dsl: Extract<OperatorDSL, { type: 'addAccuracy' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.addAccuracy(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

function parseSetAccuracy(effectId: string, dsl: Extract<OperatorDSL, { type: 'setAccuracy' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(
    Operators.setAccuracy(parseValue(effectId, dsl.value) as ValueSource<number>),
  )
}

function parseDisableContext(effectId: string, dsl: Extract<OperatorDSL, { type: 'disableContext' }>) {
  return parseSelector<UseSkillContext>(effectId, dsl.target).apply(Operators.disableContext())
}

// New clamp modifier action parsers
export function parseAddClampMaxModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addClampMaxModifier' }>,
) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.addClampMaxModifier(
      parseValue(effectId, dsl.stat) as ValueSource<StatTypeOnBattle>,
      parseValue(effectId, dsl.maxValue) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddClampMinModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addClampMinModifier' }>,
) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.addClampMinModifier(
      parseValue(effectId, dsl.stat) as ValueSource<StatTypeOnBattle>,
      parseValue(effectId, dsl.minValue) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

// Enhanced clamp modifier action parser with phase-aware support
export function parseAddClampModifierAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'addClampModifier' }>) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.addClampModifier(
      parseValue(effectId, dsl.stat) as ValueSource<StatTypeOnBattle>,
      dsl.minValue ? (parseValue(effectId, dsl.minValue) as ValueSource<number>) : undefined, // 🆕 Optional
      dsl.maxValue ? (parseValue(effectId, dsl.maxValue) as ValueSource<number>) : undefined, // 🆕 Optional
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      // 🆕 Phase-aware parameters
      dsl.phaseType
        ? (parseValue(effectId, dsl.phaseType) as ValueSource<
            'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
          >)
        : undefined,
      dsl.scope ? (parseValue(effectId, dsl.scope) as ValueSource<'current' | 'any' | 'next'>) : undefined,
      dsl.phaseId ? (parseValue(effectId, dsl.phaseId) as ValueSource<string>) : undefined,
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
    case 'foeBeDamaged':
      return Conditions.foeBeDamaged()
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
    case 'continuousUseSkill':
      return Conditions.continuousUseSkill(
        dsl.times ? (parseValue(effectId, dsl.times) as ValueSource<number>) : 2,
        dsl.strategy,
      )
    case 'statStageChange':
      return Conditions.statStageChange(
        dsl.stat ? (parseValue(effectId, dsl.stat) as ValueSource<StatTypeWithoutHp>) : undefined,
        dsl.check,
      )
    case 'isFirstSkillUsedThisTurn':
      return Conditions.isFirstSkillUsedThisTurn()
    case 'isLastSkillUsedThisTurn':
      return Conditions.isLastSkillUsedThisTurn()
    case 'selfSwitchIn':
      return Conditions.selfSwitchIn()
    case 'selfSwitchOut':
      return Conditions.selfSwitchOut()
    case 'selfBeSkillTarget':
      return Conditions.selfBeSkillTarget()
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unknown condition type: ${(dsl as any).type}`)
    }
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

// Enhanced skill attribute modifier action parsers with phase-aware support
export function parseAddSkillAttributeModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addSkillAttributeModifier' }>,
) {
  return parseSelector<SkillInstance>(effectId, dsl.target).apply(
    Operators.addSkillAttributeModifier(
      parseValue(effectId, dsl.attribute) as ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'percent' | 'delta' | 'override'>,
      parseValue(effectId, dsl.value) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      // 🆕 Phase-aware parameters
      dsl.phaseType
        ? (parseValue(effectId, dsl.phaseType) as ValueSource<
            'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
          >)
        : undefined,
      dsl.scope ? (parseValue(effectId, dsl.scope) as ValueSource<'current' | 'any' | 'next'>) : undefined,
      dsl.phaseId ? (parseValue(effectId, dsl.phaseId) as ValueSource<string>) : undefined,
    ),
  )
}

export function parseAddDynamicSkillAttributeModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addDynamicSkillAttributeModifier' }>,
) {
  return parseSelector<SkillInstance>(effectId, dsl.target).apply(
    Operators.addDynamicSkillAttributeModifier(
      parseValue(effectId, dsl.attribute) as ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'percent' | 'delta' | 'override'>,
      parseSelector(effectId, dsl.observableValue) as ValueSource<Observable<number>>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddSkillClampMaxModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addSkillClampMaxModifier' }>,
) {
  return parseSelector<SkillInstance>(effectId, dsl.target).apply(
    Operators.addSkillClampMaxModifier(
      parseValue(effectId, dsl.attribute) as ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      parseValue(effectId, dsl.maxValue) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddSkillClampMinModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addSkillClampMinModifier' }>,
) {
  return parseSelector<SkillInstance>(effectId, dsl.target).apply(
    Operators.addSkillClampMinModifier(
      parseValue(effectId, dsl.attribute) as ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      parseValue(effectId, dsl.minValue) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddSkillClampModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addSkillClampModifier' }>,
) {
  return parseSelector<SkillInstance>(effectId, dsl.target).apply(
    Operators.addSkillClampModifier(
      parseValue(effectId, dsl.attribute) as ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      parseValue(effectId, dsl.minValue) as ValueSource<number>,
      parseValue(effectId, dsl.maxValue) as ValueSource<number>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

// Config modifier action parsers
export function parseAddConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addConfigModifier' }>,
) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.addConfigModifier(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseValue(effectId, dsl.value) as ValueSource<ConfigValue>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddDynamicConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addDynamicConfigModifier' }>,
) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.addDynamicConfigModifier(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseSelector(effectId, dsl.observableValue) as ValueSource<Observable<ConfigValue>>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseRegisterConfigAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'registerConfig' }>) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.registerConfig(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.initialValue) as ValueSource<ConfigValue>,
    ),
  )
}

export function parseRegisterTaggedConfigAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'registerTaggedConfig' }>,
) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.registerTaggedConfig(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.initialValue) as ValueSource<ConfigValue>,
      parseValue(effectId, dsl.tags) as ValueSource<string[]>,
    ),
  )
}

export function parseAddTaggedConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addTaggedConfigModifier' }>,
) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.addTaggedConfigModifier(
      parseValue(effectId, dsl.tag) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseValue(effectId, dsl.value) as ValueSource<ConfigValue>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddPhaseConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addPhaseConfigModifier' }>,
) {
  return parseSelector<BattlePhaseBase>(effectId, dsl.target).apply(
    Operators.addPhaseConfigModifier(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseValue(effectId, dsl.value) as ValueSource<ConfigValue>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddPhaseDynamicConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addPhaseDynamicConfigModifier' }>,
) {
  return parseSelector<BattlePhaseBase>(effectId, dsl.target).apply(
    Operators.addPhaseDynamicConfigModifier(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseSelector(effectId, dsl.observableValue) as ValueSource<Observable<ConfigValue>>,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
    ),
  )
}

export function parseAddPhaseTypeConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addPhaseTypeConfigModifier' }>,
) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.addPhaseTypeConfigModifier(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseValue(effectId, dsl.value) as ValueSource<ConfigValue>,
      parseValue(effectId, dsl.phaseType) as ValueSource<
        'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
      >,
      dsl.scope ? (parseValue(effectId, dsl.scope) as ValueSource<'current' | 'any' | 'next'>) : undefined,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      dsl.phaseId ? (parseValue(effectId, dsl.phaseId) as ValueSource<string>) : undefined,
    ),
  )
}

export function parseAddDynamicPhaseTypeConfigModifierAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'addDynamicPhaseTypeConfigModifier' }>,
) {
  return parseSelector<ScopeObject>(effectId, dsl.target).apply(
    Operators.addDynamicPhaseTypeConfigModifier(
      parseValue(effectId, dsl.configKey) as ValueSource<string>,
      parseValue(effectId, dsl.modifierType) as ValueSource<'override' | 'delta' | 'append' | 'prepend'>,
      parseSelector(effectId, dsl.observableValue) as ValueSource<Observable<ConfigValue>>,
      parseValue(effectId, dsl.phaseType) as ValueSource<
        'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
      >,
      dsl.scope ? (parseValue(effectId, dsl.scope) as ValueSource<'current' | 'any' | 'next'>) : undefined,
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      dsl.phaseId ? (parseValue(effectId, dsl.phaseId) as ValueSource<string>) : undefined,
    ),
  )
}

// 变身相关操作符解析函数
export function parseTransformAction(effectId: string, dsl: Extract<OperatorDSL, { type: 'transform' }>) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.transform(
      parseValue(effectId, dsl.newBase) as ValueSource<any>,
      dsl.transformType
        ? (parseValue(effectId, dsl.transformType) as ValueSource<'temporary' | 'permanent'>)
        : 'temporary',
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      dsl.permanentStrategy
        ? (parseValue(effectId, dsl.permanentStrategy) as ValueSource<'preserve_temporary' | 'clear_temporary'>)
        : 'clear_temporary',
    ),
  )
}

export function parseTransformWithPreservationAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'transformWithPreservation' }>,
) {
  return parseSelector<Pet>(effectId, dsl.target).apply(
    Operators.transformWithPreservation(
      parseValue(effectId, dsl.newBase) as ValueSource<any>,
      dsl.transformType
        ? (parseValue(effectId, dsl.transformType) as ValueSource<'temporary' | 'permanent'>)
        : 'temporary',
      dsl.priority ? (parseValue(effectId, dsl.priority) as ValueSource<number>) : 0,
      dsl.permanentStrategy
        ? (parseValue(effectId, dsl.permanentStrategy) as ValueSource<'preserve_temporary' | 'clear_temporary'>)
        : 'preserve_temporary',
    ),
  )
}

export function parseRemoveTransformationAction(
  effectId: string,
  dsl: Extract<OperatorDSL, { type: 'removeTransformation' }>,
) {
  return parseSelector<Pet>(effectId, dsl.target).apply(Operators.removeTransformation())
}
