import { Type, type Static } from '@sinclair/typebox'
import type { effectId, EffectTrigger } from '@arcadia-eternity/const'
import type { Effect } from '../effect'
import { CapabilityRegistry } from './capabilities'
import type { EffectSourceKind } from './triggers'
import { defineNativeEffect } from './native-effect'
import { normalizeParams } from './parameters'
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
  | { readonly ok: true; readonly rule: CompiledRuleData; readonly effect: Effect<EffectTrigger> }
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
    claim(rule.trigger.nodeId)
    if (rule.when) claim(rule.when.nodeId)
    for (const action of rule.actions) claim(action.stepId)
    nodeId = rule.trigger.nodeId
    field = 'trigger'
    const trigger = registry.compileTrigger(rule.trigger.id, rule.trigger.params, options.sourceKind)
    nodeId = rule.when?.nodeId
    field = 'when'
    const predicate = rule.when
      ? registry.compilePredicate(rule.when.id, rule.when.params, trigger.available)
      : undefined
    const actions = rule.actions.map(action => {
      nodeId = action.stepId
      field = 'actions'
      return registry.compileAction(action.id, action.params, trigger.available)
    })
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
      actions: rule.actions.map((action, index) => ({ ...action, params: actions[index].params })),
    })
    return Object.freeze({ ok: true, rule: normalized, effect })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected content compilation failure'
    const code =
      ['LIMIT_EXCEEDED', 'DUPLICATE_ID', 'UNKNOWN_CAPABILITY', 'CAPABILITY_MISMATCH'].find(code =>
        message.startsWith(`${code}:`),
      ) ?? 'INVALID_PARAMETERS'
    return freezeContent({
      ok: false,
      diagnostics: [{ code, contentId: options.contentId, ruleId, nodeId, field, message }],
    })
  }
}
