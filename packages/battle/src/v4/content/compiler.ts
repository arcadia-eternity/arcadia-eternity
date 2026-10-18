import { Type, type Static, type TSchema } from '@sinclair/typebox'
import type { effectId, EffectTrigger } from '@arcadia-eternity/const'
import type { Effect } from '../effect'
import { CapabilityRegistry } from './capabilities'
import type { EffectSourceKind } from './triggers'
import { defineNativeEffect } from './native-effect'
import {
  normalizeParams,
  defineParameter,
  parameterAddress,
  ParameterCatalog,
  type ParameterDefinition,
} from './parameters'
import type { PublicParameterSlot, ParameterLinker } from './capability-parameters'
import { freezeContent } from './immutable'

const invocation = Type.Object(
  {
    nodeId: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    params: Type.Unknown({ default: {} }),
  },
  { additionalProperties: false },
)
const ruleSchema = Type.Object(
  {
    formatVersion: Type.Literal(1),
    id: Type.String({ minLength: 1 }),
    parameters: Type.Record(
      Type.String({ minLength: 1 }),
      Type.Object(
        {
          nodeId: Type.String({ minLength: 1 }),
          kind: Type.Union([Type.Literal('number'), Type.Literal('string'), Type.Literal('boolean')]),
          value: Type.Union([Type.Number(), Type.String(), Type.Boolean()]),
        },
        { additionalProperties: false },
      ),
      { default: {}, maxProperties: 64 },
    ),
    trigger: invocation,
    when: Type.Optional(invocation),
    actions: Type.Array(
      Type.Object(
        {
          stepId: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          params: Type.Unknown({ default: {} }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
    priority: Type.Number({ default: 0 }),
    consumesStacks: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  },
  { additionalProperties: false },
)
export type CompiledRuleData = Readonly<Static<typeof ruleSchema>>
export interface CompileDiagnostic {
  readonly code: string
  readonly contentId: string
  readonly ruleId?: string
  readonly nodeId?: string
  readonly field?: string
  readonly message: string
}
export type RuleCompileResult =
  | {
      readonly ok: true
      readonly rule: CompiledRuleData
      readonly effect: Effect<EffectTrigger>
      readonly parameters: ParameterCatalog
      readonly parameterDefinitions: readonly ParameterDefinition[]
    }
  | { readonly ok: false; readonly diagnostics: readonly CompileDiagnostic[] }

/** Structural admission only; nested battle execution budgets are a separate runtime gate. */
function checkSize(input: unknown): void {
  let nodes = 0,
    characters = 0
  const ancestors = new Set<object>()
  const walk = (value: unknown, depth: number) => {
    if (++nodes > 2048 || depth > 16) throw new Error('LIMIT_EXCEEDED: rule size or depth')
    if (typeof value === 'string') characters += value.length
    if (characters > 65536) throw new Error('LIMIT_EXCEEDED: rule text size')
    if (value && typeof value === 'object') {
      if (ancestors.has(value)) throw new Error('Invalid cyclic rule data')
      ancestors.add(value)
      for (const [key, child] of Object.entries(value)) {
        characters += key.length
        walk(child, depth + 1)
      }
      ancestors.delete(value)
    }
  }
  walk(input, 0)
}

/** Compile a validated candidate without creating a Battle, running actions or drawing RNG. */
export function compileRule(
  input: unknown,
  registry: CapabilityRegistry,
  options: {
    readonly contentId: string
    readonly sourceKind: EffectSourceKind
  },
): RuleCompileResult {
  let ruleId: string | undefined, nodeId: string | undefined, field: string | undefined
  try {
    checkSize(input)
    const rule = normalizeParams(ruleSchema, input)
    ruleId = rule.id
    const ids = new Set<string>()
    const claim = (id: string) => {
      nodeId = id
      if (ids.has(id)) throw new Error(`DUPLICATE_ID: ${id}`)
      ids.add(id)
    }
    for (const parameter of Object.values(rule.parameters)) claim(parameter.nodeId)
    claim(rule.trigger.nodeId)
    if (rule.when) claim(rule.when.nodeId)
    for (const action of rule.actions) claim(action.stepId)
    nodeId = rule.trigger.nodeId
    field = 'trigger'
    const trigger = registry.compileTrigger(rule.trigger.id, rule.trigger.params, options.sourceKind)
    const links = new Map<string, { schemas: TSchema[]; slots: PublicParameterSlot[] }>()
    const linker: ParameterLinker = (id, schema, slot) => {
      if (!Object.hasOwn(rule.parameters, id)) throw new Error(`MISSING_REFERENCE: ${id}`)
      const parameter = rule.parameters[id]
      if (typeof parameter.value !== parameter.kind)
        throw new Error(`INVALID_PARAMETERS: ${id} kind does not match value`)
      const usage = links.get(id) ?? { schemas: [], slots: [] }
      usage.schemas.push(schema)
      usage.slots.push(slot)
      links.set(id, usage)
      const address = parameterAddress(rule.id, parameter.nodeId, id)
      return {
        base: parameter.value,
        read: runtime => parameters.read(runtime.effect.battle.configSystem, address, runtime.effect.source),
      }
    }
    nodeId = rule.when?.nodeId
    field = 'when'
    const predicate = rule.when
      ? registry.compilePredicate(rule.when.id, rule.when.params, trigger.available, linker)
      : undefined
    const actions = rule.actions.map(action => {
      nodeId = action.stepId
      field = 'actions'
      return registry.compileAction(action.id, action.params, trigger.available, linker)
    })
    const parameterDefinitions = Object.entries(rule.parameters).map(([id, parameter]) => {
      nodeId = parameter.nodeId
      field = 'parameters'
      if (typeof parameter.value !== parameter.kind)
        throw new Error(`INVALID_PARAMETERS: ${id} kind does not match value`)
      const kindSchema =
        parameter.kind === 'number' ? Type.Number() : parameter.kind === 'boolean' ? Type.Boolean() : Type.String()
      const usage = links.get(id)
      const schemas = usage?.schemas ?? []
      const slots = usage?.slots ?? []
      const operations = (slots[0]?.operations ?? []).filter(operation =>
        slots.every(slot => slot.operations.includes(operation)),
      )
      return defineParameter({
        address: parameterAddress(rule.id, parameter.nodeId, id),
        schema: schemas.length ? Type.Intersect([kindSchema, ...schemas]) : kindSchema,
        effectiveSchema: slots.length
          ? Type.Intersect([kindSchema, ...slots.map(slot => slot.effectiveSchema)])
          : kindSchema,
        value: parameter.value,
        operations,
        tags: [...new Set(slots.flatMap(slot => slot.tags ?? []))],
      })
    })
    const parameters = new ParameterCatalog(parameterDefinitions)
    const effect = defineNativeEffect({
      id: rule.id as effectId,
      triggers: [trigger.trigger],
      priority: rule.priority,
      consumesStacks: rule.consumesStacks,
      when: context => trigger.matches(context) && (!predicate || predicate.test(trigger.runtime(context))),
      apply: context => {
        for (const action of actions) action.run(trigger.runtime(context))
      },
    })
    const normalized = freezeContent({
      ...rule,
      trigger: { ...rule.trigger, params: trigger.params },
      ...(rule.when && predicate ? { when: { ...rule.when, params: predicate.params } } : {}),
      actions: rule.actions.map((action, index) => ({ ...action, params: actions[index].contentParams })),
    })
    return Object.freeze({
      ok: true,
      rule: normalized,
      effect,
      parameters,
      parameterDefinitions: Object.freeze(parameterDefinitions),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected content compilation failure'
    const code =
      ['LIMIT_EXCEEDED', 'DUPLICATE_ID', 'UNKNOWN_CAPABILITY', 'CAPABILITY_MISMATCH', 'MISSING_REFERENCE'].find(code =>
        message.startsWith(`${code}:`),
      ) ?? 'INVALID_PARAMETERS'
    return freezeContent({
      ok: false,
      diagnostics: [{ code, contentId: options.contentId, ruleId, nodeId, field, message }],
    })
  }
}
