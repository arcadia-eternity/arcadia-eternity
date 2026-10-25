import { Value as SchemaValue } from '@sinclair/typebox/value'
import { compileRuleGraph } from './rule-graph'
import { ruleValueNodeSchema, ruleInputsSchema, RuleSlotError } from './rule-values'
import { scopedRuleValue, adaptRuleAction, compileRuleActions } from './authoring/runtime'
import { BaseMark, MarkInstanceImpl } from '../mark'
import { markParameterContract } from './mark-parameters'
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
import {
  compileParameterArguments,
  parameterReferenceSchema,
  instanceParameterReferenceSchema,
  type PublicParameterSlot,
  type ParameterLinker,
} from './capability-parameters'
import { ConfigModifierType } from '../config'
import { registerSingleAdmission } from './admission'
import { freezeContent } from './immutable'
import { predicateInvocationSchema, conditionSchema, validateConditionTree, compileConditionTree } from './conditions'

export const ruleSchema = Type.Object(
  {
    formatVersion: Type.Literal(1),
    id: Type.String({ minLength: 1 }),
    sourceMarkId: Type.Optional(Type.String({ minLength: 1 })),
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
    trigger: predicateInvocationSchema,
    when: Type.Optional(conditionSchema),
    roll: Type.Optional(
      Type.Object(
        {
          nodeId: Type.String({ minLength: 1 }),
          percent: Type.Union([
            Type.Number({ minimum: 0, maximum: 100 }),
            parameterReferenceSchema,
            instanceParameterReferenceSchema,
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    values: Type.Optional(Type.Array(ruleValueNodeSchema, { maxItems: 128 })),
    actions: Type.Array(
      Type.Object(
        {
          stepId: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          params: Type.Unknown({ default: {} }),
          inputs: Type.Optional(ruleInputsSchema),
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

/** A malformed rule still retains every valid identity and its exact input location. */
export class RuleStructureError extends Error {
  constructor(
    readonly ruleId: string | undefined,
    readonly nodeId: string | undefined,
    readonly field: string,
    message: string,
  ) {
    super(message)
  }
}
function rawIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function identityAtField(input: unknown, field: string): string | undefined {
  const parts = field
    .split('/')
    .slice(1)
    .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  const property = (value: unknown, key: string | undefined): unknown =>
    key !== undefined && value && typeof value === 'object' && Object.hasOwn(value, key)
      ? Reflect.get(value, key)
      : undefined
  const identify = (value: unknown, key = 'nodeId') => rawIdentity(property(value, key))
  // Identity belongs to structural rule nodes. Params and input payloads cannot supply another node ID.
  switch (parts[0]) {
    case 'actions':
    case 'values': {
      const items = property(input, parts[0])
      return Array.isArray(items) && /^\d+$/.test(parts[1] ?? '')
        ? identify(property(items, parts[1]), parts[0] === 'actions' ? 'stepId' : 'nodeId')
        : undefined
    }
    case 'parameters':
      return identify(property(property(input, 'parameters'), parts[1]))
    case 'trigger':
    case 'roll':
      return identify(property(input, parts[0]))
    case 'when': {
      let node = property(input, 'when'),
        nodeId = identify(node),
        index = 1
      while (index < parts.length) {
        if (parts[index] === 'condition' && property(node, 'kind') === 'not') {
          node = property(node, 'condition')
          index++
        } else if (parts[index] === 'conditions' && ['all', 'any'].includes(property(node, 'kind') as string)) {
          const children = property(node, 'conditions')
          if (!Array.isArray(children) || !/^\d+$/.test(parts[index + 1] ?? '')) break
          node = property(children, parts[index + 1])
          index += 2
        } else break
        nodeId = identify(node) ?? nodeId
      }
      return nodeId
    }
    default:
      return undefined
  }
}
/** Structural admission only; nested battle execution budgets remain a separate runtime gate. */
export function normalizeRuleData(input: unknown): CompiledRuleData {
  const ruleId = input && typeof input === 'object' ? rawIdentity(Reflect.get(input, 'id')) : undefined
  const fail = (field: string, message: string): never => {
    throw new RuleStructureError(ruleId, identityAtField(input, field), field, message)
  }
  let nodes = 0,
    characters = 0
  const ancestors = new Set<object>()
  const walk = (value: unknown, depth: number, field: string): void => {
    if (++nodes > 2048 || depth > 32) fail(field, 'LIMIT_EXCEEDED: rule size or depth')
    if (typeof value === 'string') characters += value.length
    if (characters > 65536) fail(field, 'LIMIT_EXCEEDED: rule text size')
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return
    if (!value || typeof value !== 'object') return fail(field, 'INVALID_PARAMETERS: expected finite JSON data')
    if (ancestors.has(value)) fail(field, 'INVALID_PARAMETERS: cyclic rule data')
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail(field, 'INVALID_PARAMETERS: expected plain JSON data')
    ancestors.add(value)
    for (const [key, child] of Object.entries(value)) {
      const path = `${field}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
      if (key === '__proto__') fail(path, 'INVALID_PARAMETERS: forbidden property')
      characters += key.length
      walk(child, depth + 1, path)
    }
    ancestors.delete(value)
  }
  walk(input, 0, '')
  try {
    return normalizeParams(ruleSchema, input)
  } catch (error) {
    const candidate = SchemaValue.Default(ruleSchema, SchemaValue.Clone(input))
    const issue = SchemaValue.Errors(ruleSchema, candidate).First()
    return fail(issue?.path ?? '', error instanceof Error ? error.message : 'Invalid rule structure')
  }
}

/** Compile a validated candidate without creating a Battle, running actions or drawing RNG. */
export function compileRule(
  input: unknown,
  registry: CapabilityRegistry,
  options: {
    readonly contentId: string
    readonly sourceKind: EffectSourceKind
    readonly sourceMark?: BaseMark
    /** A reusable behavior may narrow exposed parameters, without widening capability slots. */
    readonly parameterSchemas?: Readonly<Record<string, TSchema>>
  },
): RuleCompileResult {
  let ruleId: string | undefined, nodeId: string | undefined, field: string | undefined
  try {
    const rule = normalizeRuleData(input)
    ruleId = rule.id
    const sourceMark = options.sourceMark
    field = 'sourceMarkId'
    if (sourceMark && options.sourceKind === 'skill')
      throw new Error('CAPABILITY_MISMATCH: skill rules cannot bind a source mark')
    if (rule.sourceMarkId && (!sourceMark || sourceMark.id !== rule.sourceMarkId))
      throw new Error(`MISSING_REFERENCE: source mark ${rule.sourceMarkId}`)
    const acceptsSource = (source: unknown): boolean =>
      !sourceMark || (source instanceof MarkInstanceImpl && source.base === sourceMark)
    const ids = new Set<string>()
    const claim = (id: string) => {
      nodeId = id
      if (ids.has(id)) throw new Error(`DUPLICATE_ID: ${id}`)
      ids.add(id)
    }
    field = 'parameters'
    for (const parameter of Object.values(rule.parameters)) claim(parameter.nodeId)
    field = 'trigger'
    claim(rule.trigger.nodeId)
    field = 'when'
    if (rule.when) validateConditionTree(rule.when, claim)
    field = 'roll'
    if (rule.roll) claim(rule.roll.nodeId)
    field = 'actions'
    for (const action of rule.actions) claim(action.stepId)
    nodeId = rule.trigger.nodeId
    field = 'trigger'
    const trigger = registry.compileTrigger(rule.trigger.id, rule.trigger.params, options.sourceKind)
    const links = new Map<string, { schemas: TSchema[]; slots: PublicParameterSlot[] }>()
    const linker: ParameterLinker = (id, schema, slot, kind = 'parameter') => {
      if (kind === 'instanceParameter') {
        if (!sourceMark) throw new Error('CAPABILITY_MISMATCH: instance parameters require a bound source mark')
        const contract = markParameterContract(sourceMark)
        if (!contract || !Object.hasOwn(contract.schema.properties, id))
          throw new Error(`MISSING_REFERENCE: instance parameter ${id}`)
        const receivingType = Type.Extends(
          contract.publicParams[id].effectiveSchema,
          slot.effectiveSchema,
          Type.Literal(true),
          Type.Literal(false),
        )
        if (!('const' in receivingType) || receivingType.const !== true)
          throw new Error(`INVALID_PARAMETERS: incompatible instance parameter ${id}`)
        return {
          base: contract.normalize({})[id],
          read(runtime) {
            const source = runtime.effect.source
            if (!(source instanceof MarkInstanceImpl) || source.base !== sourceMark)
              throw new Error('Mismatched instance parameter source')
            return contract.read(runtime.effect.battle.configSystem, source, id)
          },
        }
      }
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
      ? compileConditionTree(rule.when, registry, trigger.available, linker, id => {
          nodeId = id
        })
      : undefined
    nodeId = rule.roll?.nodeId
    field = 'roll'
    const percentSchema = Type.Number({ minimum: 0, maximum: 100 })
    const roll = rule.roll
      ? compileParameterArguments(
          Type.Object({ percent: percentSchema }, { additionalProperties: false }),
          {
            percent: {
              effectiveSchema: percentSchema,
              operations: [ConfigModifierType.delta, ConfigModifierType.override],
            },
          },
          { percent: rule.roll.percent },
          linker,
        )
      : undefined
    const graph = compileRuleGraph({
      nodes: rule.values ?? [],
      registry,
      sourceKind: options.sourceKind,
      available: trigger.available,
      claim,
      numberReference(reference, schema) {
        const kind = 'parameter' in reference ? 'parameter' : 'instanceParameter'
        const id = 'parameter' in reference ? reference.parameter : reference.instanceParameter
        const slot = { effectiveSchema: schema, operations: [ConfigModifierType.delta, ConfigModifierType.override] }
        linker(id, schema, slot, kind)
        return scopedRuleValue(({ battle, source }) => {
          let result: unknown
          if (kind === 'instanceParameter') {
            if (!sourceMark || !(source instanceof MarkInstanceImpl) || source.base !== sourceMark)
              throw new Error('Mismatched instance parameter source')
            result = markParameterContract(sourceMark)!.read(battle.configSystem, source, id)
          } else {
            result = parameters.read(
              battle.configSystem,
              parameterAddress(rule.id, rule.parameters[id].nodeId, id),
              source,
            )
          }
          if (!SchemaValue.Check(schema, result)) throw new Error(`Invalid effective numeric rule parameter: ${id}`)
          return result as number
        })
      },
    })
    const actions = rule.actions.map((action, index) => {
      nodeId = action.stepId
      field = `/actions/${index}`
      const authored = graph.compileOperation(action, index)
      if (authored) return { authored: authored.action, contentParams: authored.params }
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
      const schemas = [
        ...(usage?.schemas ?? []),
        ...(options.parameterSchemas?.[id] ? [options.parameterSchemas[id]] : []),
      ]
      const slots = usage?.slots ?? []
      const operations = (slots[0]?.operations ?? []).filter(operation =>
        slots.every(slot => slot.operations.includes(operation)),
      )
      return defineParameter({
        address: parameterAddress(rule.id, parameter.nodeId, id),
        schema: schemas.length ? Type.Intersect([kindSchema, ...schemas]) : kindSchema,
        effectiveSchema: slots.length
          ? Type.Intersect([
              kindSchema,
              ...slots.map(slot => slot.effectiveSchema),
              ...(options.parameterSchemas?.[id] ? [options.parameterSchemas[id]] : []),
            ])
          : options.parameterSchemas?.[id]
            ? Type.Intersect([kindSchema, options.parameterSchemas[id]])
            : kindSchema,
        value: parameter.value,
        operations,
        tags: [...new Set(slots.flatMap(slot => slot.tags ?? []))],
      })
    })
    const parameters = new ParameterCatalog(parameterDefinitions)
    const when = (context: Parameters<typeof trigger.matches>[0]) => {
      if (
        !acceptsSource(context.source) ||
        !trigger.matches(context) ||
        (predicate && !predicate.test(() => trigger.runtime(context)))
      )
        return false
      if (!roll) return true
      const percent = roll.read({ effect: context, capabilities: {} }).percent as number
      return context.battle.random() * 100 < percent
    }
    const hasGraph = rule.values !== undefined || actions.some(action => 'authored' in action)
    const effect = hasGraph
      ? compileRuleActions({
          id: rule.id,
          trigger: trigger.trigger,
          priority: rule.priority,
          consumesStacks: rule.consumesStacks,
          when,
          acceptsSource,
          actions: actions.map(action =>
            'authored' in action ? action.authored : adaptRuleAction(context => action.run(trigger.runtime(context))),
          ),
        })
      : defineNativeEffect({
          id: rule.id as effectId,
          triggers: [trigger.trigger],
          priority: rule.priority,
          consumesStacks: rule.consumesStacks,
          when,
          apply: context => {
            if (!acceptsSource(context.source)) throw new Error('Mismatched rule source mark')
            for (const action of actions) if ('run' in action) action.run(trigger.runtime(context))
          },
        })
    registerSingleAdmission(effect)
    const normalized = freezeContent({
      ...rule,
      ...(sourceMark ? { sourceMarkId: sourceMark.id } : {}),
      trigger: { ...rule.trigger, params: trigger.params },
      ...(rule.values !== undefined ? { values: graph.nodes } : {}),
      ...(rule.roll && roll ? { roll: { ...rule.roll, ...roll.content } } : {}),
      ...(rule.when && predicate ? { when: predicate.data } : {}),
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
    if (error instanceof RuleStructureError) ruleId = error.ruleId
    if (error instanceof RuleSlotError || error instanceof RuleStructureError) {
      nodeId = error.nodeId
      field = error.field
    }
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
