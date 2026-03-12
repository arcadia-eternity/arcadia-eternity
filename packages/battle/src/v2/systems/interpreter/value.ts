// battle/src/v2/systems/interpreter/value.ts
// Value resolution for effect DSL.

import type { InterpreterContext } from './context.js'
import type { Value, SelectorDSL, SelectorChain } from '@arcadia-eternity/schema'
import {
  addConfigModifier,
  getConfigValue,
  getConfigKeysByTag,
  registerConfig,
  resolveRuntimeValue,
  type ConfigModifierType,
  type ConfigValue,
} from '@arcadia-eternity/engine'
import { resolveSelector, applyChain } from './selector.js'
import { evaluateCondition } from './conditions.js'
import { isConditionDsl } from './type-guards.js'

type RawValueNode = {
  type: 'raw:number' | 'raw:string' | 'raw:boolean'
  value: number | string | boolean
  configId?: string
  tags?: string[]
}

type TaggedConfigModifierTemplate = {
  tag: string
  modifierType: ConfigModifierType
  value: ConfigValue
  priority: number
  sourceId: string
}

function getTaggedTemplates(ctx: InterpreterContext): TaggedConfigModifierTemplate[] {
  const meta = ctx.world.meta as Record<string, unknown>
  const existing = meta.__taggedConfigModifierTemplates
  return Array.isArray(existing) ? (existing as TaggedConfigModifierTemplate[]) : []
}

function applyTaggedTemplatesIfNeeded(
  ctx: InterpreterContext,
  key: string,
  tags: string[],
): void {
  if (tags.length === 0) return
  const templates = getTaggedTemplates(ctx)
  if (templates.length === 0) return
  const taggedKeys = new Set<string>()
  for (const tag of tags) {
    for (const k of getConfigKeysByTag(ctx.world.configStore, tag)) taggedKeys.add(k)
  }
  if (!taggedKeys.has(key)) return

  for (const tpl of templates) {
    if (!tags.includes(tpl.tag)) continue
    addConfigModifier(ctx.world.configStore, key, {
      id: `configTagMod_${tpl.sourceId}_${tpl.tag}_${key}_late`,
      type: tpl.modifierType,
      value: tpl.value,
      priority: tpl.priority,
      sourceId: tpl.sourceId,
      durationType: 'binding',
    })
  }
}

function resolveRawConfigValue(ctx: InterpreterContext, raw: RawValueNode): unknown {
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string' && t.length > 0) : []
  const effectId = typeof ctx.fireCtx.effectId === 'string' ? ctx.fireCtx.effectId : 'anonymous_effect'

  const key = (() => {
    if (raw.configId) {
      return raw.configId.includes('.')
        ? raw.configId
        : `${effectId}.${raw.configId}`
    }
    if (tags.length > 0) {
      const tagPart = tags.join('|')
      return `${effectId}.__raw__.${raw.type}.${String(raw.value)}.${tagPart}`
    }
    return undefined
  })()

  if (!key) return raw.value

  // v1-compatible behavior: raw value with configId is a config-backed literal with default value.
  if (getConfigValue(ctx.world.configStore, key) === undefined) {
    registerConfig(ctx.world.configStore, key, raw.value, tags)
    applyTaggedTemplatesIfNeeded(ctx, key, tags)
  }

  const configured = getConfigValue(ctx.world.configStore, key)
  return configured ?? raw.value
}

/**
 * Resolve a Value to its actual runtime value.
 *
 * Value types:
 * - number/string/boolean — literal primitives
 * - { type: 'raw:number/string/boolean', value } — wrapped primitives
 * - { type: 'entity:baseMark/baseSkill/...', value } — entity ID strings
 * - { type: 'dynamic', selector } — resolve selector, return first result
 * - { type: 'selectorValue', value, chain? } — resolve value, apply chain
 * - { type: 'conditional', condition, trueValue, falseValue } — conditional branch
 * - Array<Value> — map resolveValue over array
 * - OperatorDSL — return as-is (for nested operators)
 */
export function resolveValue(ctx: InterpreterContext, value: Value | null | undefined): unknown {
  return resolveRuntimeValue(value, {
    resolveSelector: selector => resolveSelector(ctx, selector as SelectorDSL),
    applyChain: (results, chain) => applyChain(ctx, results, chain as SelectorChain[]),
    evaluateCondition: condition => isConditionDsl(condition) && evaluateCondition(ctx, condition),
    resolveRawValue: (raw: unknown) => resolveRawConfigValue(ctx, raw as RawValueNode),
  })
}
