// engine/src/dsl/resolvers.ts
// Resolver-focused runtime implementations.

import type {
  CommonSelectorChainStep,
  RuntimeSelectorChain,
  RuntimeSelectorConditional,
  RuntimeSelectorHooks,
  RuntimeSelectorValue,
  RuntimeValueConditional,
  RuntimeValueDynamic,
  RuntimeValueEntity,
  RuntimeValueHooks,
  RuntimeValueRaw,
  RuntimeValueSelectorValue,
  SelectorChainRuntimeHooks,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function applyCommonSelectorChain<
  TValue,
  TSelector,
  TCondition,
  TEvaluator,
  TExtractor,
>(
  initial: unknown[],
  chain: CommonSelectorChainStep<TValue, TSelector, TCondition, TEvaluator, TExtractor>[],
  hooks: SelectorChainRuntimeHooks<TValue, TSelector, TCondition, TEvaluator, TExtractor>,
): unknown[] {
  let current = initial

  for (const step of chain) {
    switch (step.type) {
      case 'select': {
        current = current.flatMap(item => hooks.applyExtractor(item, step.arg))
        break
      }
      case 'selectPath': {
        const path = step.arg.split('.')
        current = current
          .map(item => {
            let value: unknown = item
            for (const key of path) {
              if (!isRecord(value)) return undefined
              value = value[key]
            }
            return value
          })
          .filter(v => v !== undefined)
        break
      }
      case 'selectProp': {
        current = current
          .map(item => (isRecord(item) ? item[step.arg] : undefined))
          .filter(v => v !== undefined)
        break
      }
      case 'where': {
        current = current.filter(item => hooks.evaluateEvaluator(item, step.arg))
        break
      }
      case 'whereAttr': {
        current = current.filter(item => {
          const extracted = hooks.applyExtractor(item, step.extractor)
          return extracted.length > 0 && hooks.evaluateEvaluator(extracted[0], step.evaluator)
        })
        break
      }
      case 'flat': {
        current = current.flat()
        break
      }
      case 'and': {
        const other = hooks.resolveSelector(step.arg)
        const set = new Set(other.map(item => String(item)))
        current = current.filter(item => set.has(String(item)))
        break
      }
      case 'or': {
        const other = hooks.resolveSelector(step.arg)
        if (step.duplicate) {
          current = [...current, ...other]
          break
        }
        const seen = new Set(current.map(item => String(item)))
        const unique = other.filter(item => !seen.has(String(item)))
        current = [...current, ...unique]
        break
      }
      case 'sum': {
        const sum = current.reduce<number>((acc, item) => acc + (toFiniteNumber(item) ?? 0), 0)
        current = [sum]
        break
      }
      case 'avg': {
        const nums = current.map(toFiniteNumber).filter((n): n is number => n !== null)
        const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
        current = [avg]
        break
      }
      case 'add': {
        const delta = toFiniteNumber(hooks.resolveValue(step.arg))
        if (delta === null) break
        current = current.map(item => (typeof item === 'number' ? item + delta : item))
        break
      }
      case 'multiply': {
        const factor = toFiniteNumber(hooks.resolveValue(step.arg))
        if (factor === null) break
        current = current.map(item => (typeof item === 'number' ? item * factor : item))
        break
      }
      case 'divide': {
        const divisor = toFiniteNumber(hooks.resolveValue(step.arg))
        if (divisor === null || divisor === 0) break
        current = current.map(item => (typeof item === 'number' ? item / divisor : item))
        break
      }
      case 'shuffled': {
        current = hooks.shuffle(current)
        break
      }
      case 'limit': {
        const count = toFiniteNumber(hooks.resolveValue(step.arg))
        if (count === null) break
        current = current.slice(0, Math.max(0, Math.floor(count)))
        break
      }
      case 'clampMax': {
        const max = toFiniteNumber(hooks.resolveValue(step.arg))
        if (max === null) break
        current = current.map(item => (typeof item === 'number' ? Math.min(item, max) : item))
        break
      }
      case 'clampMin': {
        const min = toFiniteNumber(hooks.resolveValue(step.arg))
        if (min === null) break
        current = current.map(item => (typeof item === 'number' ? Math.max(item, min) : item))
        break
      }
      case 'randomPick':
      case 'randomSample': {
        const count = toFiniteNumber(hooks.resolveValue(step.arg))
        if (count === null) break
        current = hooks.shuffle([...current]).slice(0, Math.max(0, Math.floor(count)))
        break
      }
      case 'when': {
        const picked = hooks.evaluateCondition(step.condition) ? step.trueValue : step.falseValue
        current = [hooks.resolveValue(picked as TValue)]
        break
      }
      case 'configGet': {
        const key = hooks.resolveValue(step.key)
        if (typeof key !== 'string') break
        current = [hooks.getConfigValue(key)]
        break
      }
      default:
        break
    }
  }

  return current
}

export type RuntimeValueInput<TSelector, TChain, TCondition, TOpaque = never> =
  | RuntimeValueRaw
  | RuntimeValueEntity
  | RuntimeValueDynamic<TSelector>
  | RuntimeValueSelectorValue<RuntimeValueInput<TSelector, TChain, TCondition, TOpaque>, TChain>
  | RuntimeValueConditional<TCondition, RuntimeValueInput<TSelector, TChain, TCondition, TOpaque>>
  | RuntimeValueInput<TSelector, TChain, TCondition, TOpaque>[]
  | TOpaque

export function resolveRuntimeValue<TValue, TSelector, TChain, TCondition>(
  value: TValue | null | undefined,
  hooks: RuntimeValueHooks<TSelector, TChain, TCondition>,
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(v => resolveRuntimeValue(v, hooks))

  if (typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string') {
    const node = value as Record<string, unknown> & { type: string }
    switch (node.type) {
      case 'raw:number':
      case 'raw:string':
      case 'raw:boolean':
        if (hooks.resolveRawValue && 'value' in node) {
          return hooks.resolveRawValue(node as unknown as RuntimeValueRaw)
        }
        return node.value
      case 'entity:baseMark':
      case 'entity:baseSkill':
      case 'entity:species':
      case 'entity:effect':
        return node.value
      case 'dynamic': {
        const results = hooks.resolveSelector(node.selector as TSelector)
        return results[0]
      }
      case 'selectorValue': {
        const base = resolveRuntimeValue(node.value as TValue, hooks)
        if (Array.isArray(node.chain)) {
          const results = hooks.applyChain([base], node.chain as TChain[])
          return results[0]
        }
        return base
      }
      case 'conditional': {
        const branch = hooks.evaluateCondition(node.condition as TCondition)
          ? node.trueValue
          : node.falseValue
        return resolveRuntimeValue(branch as TValue, hooks)
      }
      default:
        return node
    }
  }

  return value
}

export type RuntimeSelectorInput<TBase extends string, TChain, TCondition, TValue> =
  | TBase
  | RuntimeSelectorChain<TBase, TChain>
  | RuntimeSelectorConditional<RuntimeSelectorInput<TBase, TChain, TCondition, TValue>, TCondition>
  | RuntimeSelectorValue<TValue, TChain>

export function resolveRuntimeSelector<TBase extends string, TChain, TCondition, TValue>(
  selector: RuntimeSelectorInput<TBase, TChain, TCondition, TValue> | undefined,
  hooks: RuntimeSelectorHooks<TBase, TChain, TCondition, TValue>,
): unknown[] {
  if (typeof selector === 'string') {
    return hooks.resolveBase(selector)
  }

  if (!selector) return []

  if ('base' in selector) {
    let results = hooks.resolveBase(selector.base)
    if (Array.isArray(selector.chain)) {
      results = hooks.applyChain(results, selector.chain)
    }
    return results
  }

  if ('condition' in selector && 'trueSelector' in selector) {
    const ok = hooks.evaluateCondition(selector.condition)
    return resolveRuntimeSelector(
      ok ? selector.trueSelector : selector.falseSelector,
      hooks,
    )
  }

  if ('type' in selector && selector.type === 'selectorValue') {
    let results = [hooks.resolveValue(selector.value)]
    if (Array.isArray(selector.chain)) {
      results = hooks.applyChain(results, selector.chain)
    }
    return results
  }

  return []
}
