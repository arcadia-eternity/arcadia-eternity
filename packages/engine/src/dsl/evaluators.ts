// engine/src/dsl/evaluators.ts
// Evaluator-focused runtime implementations.

import type {
  CommonCondition,
  CommonConditionHooks,
  CompareOperator,
  EvaluatorRuntimeHooks,
  NumericEvalHooks,
  RuntimeEvaluator,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function compareValues(left: unknown, operator: CompareOperator, right: unknown): boolean {
  switch (operator) {
    case '>':
      if (typeof left !== 'number' || typeof right !== 'number') return false
      return left > right
    case '>=':
      if (typeof left !== 'number' || typeof right !== 'number') return false
      return left >= right
    case '<':
      if (typeof left !== 'number' || typeof right !== 'number') return false
      return left < right
    case '<=':
      if (typeof left !== 'number' || typeof right !== 'number') return false
      return left <= right
    case '==':
      return left === right
    case '!=':
      return left !== right
    default:
      return false
  }
}

export function evaluateRuntimeEvaluator<TValue>(
  value: unknown,
  evaluator: RuntimeEvaluator<TValue>,
  hooks: EvaluatorRuntimeHooks<TValue>,
): boolean {
  switch (evaluator.type) {
    case 'compare': {
      return compareValues(value, evaluator.operator, hooks.resolveValue(evaluator.value))
    }
    case 'same': {
      return value === hooks.resolveValue(evaluator.value)
    }
    case 'notSame': {
      return value !== hooks.resolveValue(evaluator.value)
    }
    case 'probability': {
      const percent = toFiniteNumber(hooks.resolveValue(evaluator.percent))
      return hooks.randomPercent(percent ?? 0)
    }
    case 'contain': {
      if (Array.isArray(value)) return value.includes(evaluator.tag)
      return value === evaluator.tag
    }
    case 'exist': {
      return value !== undefined && value !== null
    }
    case 'anyOf': {
      const compareValue = hooks.resolveValue(evaluator.value)
      return Array.isArray(compareValue) ? compareValue.includes(value) : value === compareValue
    }
    case 'any': {
      return evaluator.conditions.some(cond => evaluateRuntimeEvaluator(value, cond, hooks))
    }
    case 'all': {
      return evaluator.conditions.every(cond => evaluateRuntimeEvaluator(value, cond, hooks))
    }
    case 'not': {
      return !evaluateRuntimeEvaluator(value, evaluator.condition, hooks)
    }
    default:
      return false
  }
}

export function evaluateCommonCondition<TCondition, TSelector, TEvaluator>(
  condition: boolean | null | undefined | CommonCondition<TCondition, TSelector, TEvaluator>,
  hooks: CommonConditionHooks<TCondition, TSelector, TEvaluator>,
): boolean | undefined {
  if (condition === undefined || condition === null) return true
  if (typeof condition === 'boolean') return condition

  switch (condition.type) {
    case 'every': {
      const conditions = Array.isArray(condition.conditions) ? condition.conditions : []
      return conditions.every(c => hooks.evaluateCondition(c))
    }
    case 'some': {
      const conditions = Array.isArray(condition.conditions) ? condition.conditions : []
      return conditions.some(c => hooks.evaluateCondition(c))
    }
    case 'not': {
      return !hooks.evaluateCondition(condition.condition)
    }
    case 'evaluate': {
      const results = hooks.resolveSelector(condition.target)
      return results.some(item => hooks.evaluateEvaluator(item, condition.evaluator))
    }
    default:
      return undefined
  }
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + toNumber(item), 0)
  }
  return 0
}

function evalFormulaNode<TSelector, TValue>(
  node: Record<string, unknown>,
  hooks: NumericEvalHooks<TSelector, TValue>,
): number {
  if (typeof node.value === 'number') return node.value

  if (typeof node.entityId === 'string' && typeof node.attribute === 'string') {
    return hooks.resolveRef(node.entityId, node.attribute)
  }

  const op = typeof node.op === 'string' ? node.op : undefined
  if (!op) return 0

  if (op === 'selectorValue') {
    return hooks.resolveSelector ? hooks.resolveSelector(node.selector as TSelector) : 0
  }

  const args = Array.isArray(node.args)
    ? node.args
    : [node.left, node.right].filter((x): x is unknown => x !== undefined)

  const values = args.map(arg => evaluateNumericExpression(arg, hooks))

  switch (op) {
    case 'sum':
    case 'add':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
    case 'multiply':
    case 'mul':
      return values.reduce((a, b) => a * b, values.length > 0 ? 1 : 0)
    case 'subtract':
    case 'sub':
      return values.length === 0 ? 0 : values.slice(1).reduce((a, b) => a - b, values[0])
    case 'divide':
    case 'div': {
      if (values.length === 0) return 0
      return values.slice(1).reduce((a, b) => (b === 0 ? a : a / b), values[0])
    }
    case 'min':
      return values.length > 0 ? Math.min(...values) : 0
    case 'max':
      return values.length > 0 ? Math.max(...values) : 0
    case 'pow':
      return values.length >= 2 ? Math.pow(values[0], values[1]) : (values[0] ?? 0)
    case 'abs':
      return Math.abs(values[0] ?? 0)
    case 'floor':
      return Math.floor(values[0] ?? 0)
    case 'ceil':
      return Math.ceil(values[0] ?? 0)
    case 'round':
      return Math.round(values[0] ?? 0)
    case 'neg':
      return -(values[0] ?? 0)
    case 'clamp': {
      const base = values[0] ?? 0
      const min = values[1]
      const max = values[2]
      if (typeof min === 'number' && base < min) return min
      if (typeof max === 'number' && base > max) return max
      return base
    }
    default:
      return 0
  }
}

export function evaluateNumericExpression<TSelector, TValue>(
  expr: unknown,
  hooks: NumericEvalHooks<TSelector, TValue>,
): number {
  if (typeof expr === 'number') return expr
  if (Array.isArray(expr)) return expr.reduce<number>((sum, item) => sum + evaluateNumericExpression(item, hooks), 0)
  if (!isRecord(expr)) return 0

  if (expr.type === 'ref' && typeof expr.entityId === 'string' && typeof expr.attribute === 'string') {
    return hooks.resolveRef(expr.entityId, expr.attribute)
  }

  if (expr.type === 'formula') {
    return evalFormulaNode(expr, hooks)
  }

  if (hooks.resolveSelector && (typeof expr.base === 'string' || typeof expr.type === 'string')) {
    const selectorValue = hooks.resolveSelector(expr as TSelector)
    if (selectorValue !== 0) return selectorValue
  }

  if (hooks.resolveValue) {
    return hooks.resolveValue(expr as TValue)
  }

  return 0
}
