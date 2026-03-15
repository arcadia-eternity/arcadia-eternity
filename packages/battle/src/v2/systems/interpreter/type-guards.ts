import type {
  ConditionDSL,
  EvaluatorDSL,
  ExtractorDSL,
  SelectorChain,
  SelectorDSL,
  SelectorValue,
} from '@arcadia-eternity/schema'
import type {
  DamageContextData,
  UseSkillContextData,
} from '../../schemas/context.schema.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasStringType(value: unknown): value is { type: string } {
  return isRecord(value) && typeof value.type === 'string'
}

export function isUseSkillContext(value: unknown): value is UseSkillContextData {
  return hasStringType(value) && value.type === 'use-skill'
}

export function isDamageContext(value: unknown): value is DamageContextData {
  return hasStringType(value) && value.type === 'damage'
}

export function isSelectorValue(value: unknown): value is SelectorValue {
  return hasStringType(value) && value.type === 'selectorValue' && 'value' in value
}

export function isSelectorChain(value: unknown): value is SelectorChain {
  if (!hasStringType(value)) return false
  const rec = value as Record<string, unknown>
  switch (value.type) {
    case 'select':
      return 'arg' in rec && isExtractorDsl(rec.arg)
    case 'selectPath':
    case 'selectProp':
    case 'selectObservable':
    case 'selectAttribute$':
      return typeof rec.arg === 'string'
    case 'where':
      return 'arg' in rec && isEvaluatorDsl(rec.arg)
    case 'whereAttr':
      return isExtractorDsl(rec.extractor) && isEvaluatorDsl(rec.evaluator)
    case 'and':
    case 'or':
      return 'arg' in rec
    case 'randomPick':
    case 'randomSample':
    case 'add':
    case 'multiply':
    case 'divide':
    case 'limit':
    case 'clampMax':
    case 'clampMin':
      return 'arg' in value
    case 'configGet':
      return 'key' in value
    case 'sum':
    case 'avg':
    case 'flat':
    case 'shuffled':
    case 'asStatLevelMark':
    case 'sampleBetween':
      return true
    case 'when':
      return 'condition' in value && 'trueValue' in value
    default:
      return false
  }
}

export function isChainSelector(value: unknown): value is { base: string; chain?: SelectorChain[] } {
  return isRecord(value)
    && typeof value.base === 'string'
    && (value.chain === undefined || (Array.isArray(value.chain) && value.chain.every(isSelectorChain)))
}

export function isConditionalSelector(
  value: unknown,
): value is { condition: ConditionDSL; trueSelector: SelectorDSL; falseSelector?: SelectorDSL } {
  return isRecord(value) && 'condition' in value && 'trueSelector' in value
}

export function isExtractorDsl(value: unknown): value is ExtractorDSL {
  if (typeof value === 'string') return true
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'base' || value.type === 'dynamic') return typeof value.arg === 'string'
  if (value.type === 'attribute') return typeof value.key === 'string'
  if (value.type === 'relation') return typeof value.key === 'string'
  if (value.type === 'field') return typeof value.path === 'string'
  return false
}

export function isSelectorDsl(value: unknown): value is SelectorDSL {
  if (typeof value === 'string') return true
  return isSelectorValue(value) || isChainSelector(value) || isConditionalSelector(value)
}

export function isConditionDsl(value: unknown): value is ConditionDSL {
  if (!hasStringType(value)) return false
  const rec = value as Record<string, unknown>
  switch (value.type) {
    case 'evaluate':
      return 'target' in rec && 'evaluator' in rec && isEvaluatorDsl(rec.evaluator)
    case 'some':
    case 'every':
      return Array.isArray(rec.conditions) && rec.conditions.every(isConditionDsl)
    case 'not':
      return 'condition' in rec && isConditionDsl(rec.condition)
    case 'selfHasMark':
    case 'opponentHasMark':
      return 'baseId' in value
    case 'continuousUseSkill':
      return true
    case 'skillSequence':
      return 'sequence' in rec
    case 'statStageChange':
    case 'petIsActive':
    case 'selfUseSkill':
    case 'checkSelf':
    case 'opponentUseSkill':
    case 'selfBeDamaged':
    case 'opponentBeDamaged':
    case 'selfAddMark':
    case 'opponentAddMark':
    case 'selfBeAddMark':
    case 'opponentBeAddMark':
    case 'selfBeHeal':
    case 'isFirstSkillUsedThisTurn':
    case 'isLastSkillUsedThisTurn':
    case 'selfSwitchIn':
    case 'selfSwitchOut':
    case 'selfBeSkillTarget':
      return true
    default:
      return false
  }
}

export function isEvaluatorDsl(value: unknown): value is EvaluatorDSL {
  if (!hasStringType(value)) return false
  const rec = value as Record<string, unknown>
  switch (value.type) {
    case 'compare':
      return typeof rec.operator === 'string' && 'value' in rec
    case 'same':
    case 'notSame':
    case 'anyOf':
      return 'value' in rec
    case 'any':
    case 'all':
      return Array.isArray(rec.conditions) && rec.conditions.every(isEvaluatorDsl)
    case 'not':
      return 'condition' in rec && isEvaluatorDsl(rec.condition)
    case 'probability':
      return 'percent' in rec
    case 'contain':
      return typeof rec.tag === 'string'
    case 'exist':
      return true
    default:
      return false
  }
}
