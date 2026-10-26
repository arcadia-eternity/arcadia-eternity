import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { StackStrategy, type baseMarkId } from '@arcadia-eternity/const'
import { BaseMark } from '../mark'
import { ConfigModifierType } from '../config'
import { CapabilityRegistry, type RegisteredAction, type RegisteredPredicate } from './capabilities'
import type { RegisteredRuleValue, RegisteredRuleOperation } from './rule-values'
import type { RegisteredTrigger } from './triggers'
import {
  compileRule,
  normalizeRuleData,
  RuleStructureError,
  ruleSchema,
  type CompileDiagnostic,
  type RuleCompileResult,
} from './compiler'
import { defineMarkInstanceParams } from './mark-parameters'
import { defineAddMarkAction } from './mark-actions'
import { normalizeParams, ParameterCatalog, type ParameterDefinition } from './parameters'
import { coreCapabilities } from './core-capabilities'
import { freezeContent } from './immutable'
import type { PublicParameterSlot } from './capability-parameters'

/** Trusted TypeBox contracts, selected by ID; pack authors never supply executable schemas. */
export interface InstanceParameterPreset extends PublicParameterSlot {
  readonly id: string
  readonly schema: TSchema
}
const numericOperations = [ConfigModifierType.delta, ConfigModifierType.override] as const
export const coreInstanceParameterPresets: readonly InstanceParameterPreset[] = freezeContent([
  {
    id: 'core.ratio',
    schema: Type.Number({ minimum: 0, maximum: 1, default: 0.2 }),
    effectiveSchema: Type.Number({ minimum: 0, maximum: 1 }),
    operations: numericOperations,
  },
  {
    id: 'core.percent',
    schema: Type.Number({ minimum: 0, maximum: 100, default: 100 }),
    effectiveSchema: Type.Number({ minimum: 0, maximum: 100 }),
    operations: numericOperations,
  },
  {
    id: 'core.amount',
    schema: Type.Number({ minimum: 0, default: 0 }),
    effectiveSchema: Type.Number({ minimum: 0 }),
    operations: numericOperations,
  },
  {
    id: 'core.enabled',
    schema: Type.Boolean({ default: true }),
    effectiveSchema: Type.Boolean(),
    operations: [ConfigModifierType.override],
  },
])
const id = Type.String({ minLength: 1, maxLength: 256 })
const scalar = Type.Union([Type.Number(), Type.String(), Type.Boolean()])
const markConfig = Type.Object(
  {
    duration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 3 }),
    persistent: Type.Boolean({ default: true }),
    maxStacks: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1 }),
    stackable: Type.Boolean({ default: false }),
    stackStrategy: Type.Enum(StackStrategy, { default: StackStrategy.extend }),
    destroyable: Type.Boolean({ default: true }),
    isShield: Type.Boolean({ default: false }),
    keepOnSwitchOut: Type.Boolean({ default: false }),
    transferOnSwitch: Type.Boolean({ default: false }),
    inheritOnFaint: Type.Boolean({ default: false }),
    mutexGroup: Type.Optional(id),
  },
  { additionalProperties: false, default: {} },
)
const packSchema = Type.Object(
  {
    formatVersion: Type.Literal(1),
    id,
    marks: Type.Array(
      Type.Object(
        {
          id,
          config: markConfig,
          tags: Type.Array(id, { maxItems: 64, uniqueItems: true, default: [] }),
          instanceParams: Type.Record(
            id,
            Type.Object({ presetId: id, value: Type.Optional(scalar) }, { additionalProperties: false }),
            { maxProperties: 64, default: {} },
          ),
          effects: Type.Array(id, { maxItems: 64, uniqueItems: true, default: [] }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64, default: [] },
    ),
    markActions: Type.Array(
      Type.Object(
        { id, markId: id, target: Type.Union([Type.Literal('ownerPet'), Type.Literal('skillTarget')]) },
        { additionalProperties: false },
      ),
      { maxItems: 128, default: [] },
    ),
    rules: Type.Array(
      Type.Object(
        { sourceKind: Type.Union([Type.Literal('skill'), Type.Literal('petMark')]), rule: ruleSchema },
        { additionalProperties: false },
      ),
      { maxItems: 256, default: [] },
    ),
  },
  { additionalProperties: false },
)
export type ContentPackData = Readonly<Static<typeof packSchema>>
type CompiledRule = Extract<RuleCompileResult, { ok: true }>
export type ContentPackResult =
  | {
      readonly ok: true
      readonly data: ContentPackData
      readonly marks: readonly BaseMark[]
      readonly rules: readonly CompiledRule[]
      readonly registry: CapabilityRegistry
      readonly parameters: ParameterCatalog
    }
  | { readonly ok: false; readonly diagnostics: readonly CompileDiagnostic[] }

/** Bounds apply before recursive JSON normalization or TypeBox default traversal. */
function checkPackSize(input: unknown): void {
  let nodes = 0,
    text = 0
  const ancestors = new Set<object>()
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 65536 || depth > 40) throw new Error('LIMIT_EXCEEDED: pack size or depth')
    if (typeof value === 'string') text += value.length
    if (text > 1048576) throw new Error('LIMIT_EXCEEDED: pack text size')
    if (!value || typeof value !== 'object') return
    if (ancestors.has(value)) throw new Error('INVALID_PARAMETERS: cyclic pack')
    ancestors.add(value)
    for (const [key, child] of Object.entries(value)) {
      text += key.length
      visit(child, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(input, 0)
}

/** Build an isolated candidate. No existing registry, Battle, or published content is mutated. */
export function compileContentPack(
  input: unknown,
  trusted: {
    readonly actions?: readonly RegisteredAction[]
    readonly triggers?: readonly RegisteredTrigger[]
    readonly predicates?: readonly RegisteredPredicate[]
    readonly values?: readonly RegisteredRuleValue[]
    readonly operations?: readonly RegisteredRuleOperation[]
    readonly parameterPresets?: readonly InstanceParameterPreset[]
  } = {},
): ContentPackResult {
  let contentId = '<pack>',
    field: string | undefined
  try {
    checkPackSize(input)
    // Validate embedded rule structures before the enclosing pack schema can hide their location.
    const rawRules = input && typeof input === 'object' ? Reflect.get(input, 'rules') : undefined
    if (Array.isArray(rawRules)) {
      for (const [index, entry] of rawRules.entries()) {
        if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'rule')) continue
        try {
          normalizeRuleData(Reflect.get(entry, 'rule'))
        } catch (error) {
          if (!(error instanceof RuleStructureError)) throw error
          return {
            ok: false,
            diagnostics: [
              {
                code: error.message.startsWith('LIMIT_EXCEEDED:') ? 'LIMIT_EXCEEDED' : 'INVALID_PARAMETERS',
                contentId: error.ruleId ?? contentId,
                ruleId: error.ruleId,
                nodeId: error.nodeId,
                field: `/rules/${index}/rule${error.field}`,
                message: error.message,
              },
            ],
          }
        }
      }
    }
    const data = normalizeParams(packSchema, input)
    contentId = data.id
    const claim = (seen: Set<string>, value: string): void => {
      if (!value.startsWith(`${data.id}/`)) throw new Error(`INVALID_ID: ${value} must belong to ${data.id}/`)
      if (seen.has(value)) throw new Error(`DUPLICATE_ID: ${value}`)
      seen.add(value)
    }
    const presets = new Map<string, InstanceParameterPreset>()
    for (const preset of [...coreInstanceParameterPresets, ...(trusted.parameterPresets ?? [])]) {
      if (presets.has(preset.id)) throw new Error(`DUPLICATE_ID: parameter preset ${preset.id}`)
      presets.set(preset.id, preset)
    }
    const marks = new Map<string, BaseMark>()
    const owners = new Map<string, BaseMark>()
    const parameterDefinitions: ParameterDefinition[] = []
    const normalizedMarks: ContentPackData['marks'] = []
    field = 'marks'
    const markIds = new Set<string>()
    for (const declaration of data.marks) {
      contentId = declaration.id
      claim(markIds, declaration.id)
      const mark = new BaseMark(declaration.id as baseMarkId, [], declaration.config, [...declaration.tags])
      const properties: Record<string, TSchema> = {}
      const slots: Record<string, PublicParameterSlot> = {}
      for (const [name, parameter] of Object.entries(declaration.instanceParams)) {
        const preset = presets.get(parameter.presetId)
        if (!preset) throw new Error(`MISSING_REFERENCE: parameter preset ${parameter.presetId}`)
        Object.defineProperty(properties, name, {
          enumerable: true,
          value: {
            ...Value.Clone(preset.schema),
            default: parameter.value === undefined ? preset.schema.default : parameter.value,
          },
        })
        Object.defineProperty(slots, name, { enumerable: true, value: preset })
      }
      const contract = defineMarkInstanceParams(mark, Type.Object(properties, { additionalProperties: false }), slots)
      parameterDefinitions.push(...contract.parameterDefinitions)
      const defaults = contract.capture({})
      normalizedMarks.push({
        ...declaration,
        instanceParams: Object.fromEntries(
          Object.entries(declaration.instanceParams).map(([name, parameter]) => [
            name,
            { ...parameter, value: defaults[name] },
          ]),
        ),
      })
      marks.set(mark.id, mark)
      for (const effect of declaration.effects) {
        if (owners.has(effect)) throw new Error(`DUPLICATE_ID: mark effect owner ${effect}`)
        owners.set(effect, mark)
      }
    }
    field = 'markActions'
    const actionIds = new Set<string>()
    const actions = data.markActions.map(declaration => {
      contentId = declaration.id
      claim(actionIds, declaration.id)
      const mark = marks.get(declaration.markId)
      if (!mark) throw new Error(`MISSING_REFERENCE: mark ${declaration.markId}`)
      return defineAddMarkAction({ id: declaration.id, mark, target: declaration.target })
    })
    const registry = new CapabilityRegistry([...coreCapabilities.actions, ...(trusted.actions ?? []), ...actions], {
      triggers: [...coreCapabilities.triggers, ...(trusted.triggers ?? [])],
      predicates: [...coreCapabilities.predicates, ...(trusted.predicates ?? [])],
      values: [...coreCapabilities.values, ...(trusted.values ?? [])],
      operations: [...coreCapabilities.operations, ...(trusted.operations ?? [])],
    })
    field = 'rules'
    const ruleIds = new Set<string>()
    const rules: CompiledRule[] = []
    for (const entry of data.rules) {
      contentId = entry.rule.id
      claim(ruleIds, entry.rule.id)
      const sourceMark = owners.get(entry.rule.id)
      if ((entry.sourceKind === 'petMark') !== !!sourceMark)
        throw new Error(`CAPABILITY_MISMATCH: ${entry.rule.id} must have exactly one matching mark source`)
      const compiled = compileRule(entry.rule, registry, { contentId, sourceKind: entry.sourceKind, sourceMark })
      if (!compiled.ok) return compiled
      rules.push(Object.freeze(compiled))
      parameterDefinitions.push(...compiled.parameterDefinitions)
    }
    for (const declaration of data.marks) {
      contentId = declaration.id
      field = 'effects'
      const mark = marks.get(declaration.id)!
      for (const id of declaration.effects) {
        const compiled = rules.find(candidate => candidate.rule.id === id)
        if (!compiled) throw new Error(`MISSING_REFERENCE: effect ${id}`)
        mark.effects.push(compiled.effect)
      }
      Object.freeze(mark.effects)
      Object.freeze(mark.tags)
      Object.freeze(mark)
    }
    const parameters = new ParameterCatalog(parameterDefinitions)
    return Object.freeze({
      ok: true,
      data: freezeContent({
        ...data,
        marks: normalizedMarks,
        rules: data.rules.map((entry, index) => ({ ...entry, rule: rules[index].rule })),
      }),
      marks: Object.freeze([...marks.values()]),
      rules: Object.freeze(rules),
      registry,
      parameters,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Invalid content pack'
    return {
      ok: false,
      diagnostics: [
        { code: message.includes(':') ? message.split(':')[0] : 'INVALID_PARAMETERS', contentId, field, message },
      ],
    }
  }
}
