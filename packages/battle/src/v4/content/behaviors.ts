import { Type, type Static, type TSchema } from '@sinclair/typebox'
import type { EffectTrigger } from '@arcadia-eternity/const'
import type { Effect } from '../effect'
import type { BaseMark } from '../mark'
import type { CapabilityRegistry } from './capabilities'
import {
  compileRule,
  ruleSchema,
  type CompiledRuleData,
  type CompileDiagnostic,
  type RuleCompileResult,
} from './compiler'
import { normalizeParams, parameterAddress, type ParameterCatalog } from './parameters'
import { freezeContent } from './immutable'
import { compileEffect, effectParameters } from './authoring/runtime'
import type { EffectDefinition, Parameter, Trigger } from './authoring/contracts'

const id = Type.String({ minLength: 1, maxLength: 256 })
const scalar = Type.Union([Type.Number(), Type.String({ maxLength: 4096 }), Type.Boolean()])
const sourceKind = Type.Union([Type.Literal('skill'), Type.Literal('petMark')])
const publicParameterSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('number'),
      default: Type.Number(),
      minimum: Type.Optional(Type.Number()),
      maximum: Type.Optional(Type.Number()),
      integer: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('boolean'), default: Type.Boolean() }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal('string'),
      default: Type.String({ maxLength: 4096 }),
      enum: Type.Optional(
        Type.Array(Type.String({ maxLength: 4096 }), { minItems: 1, maxItems: 64, uniqueItems: true }),
      ),
      maxLength: Type.Optional(Type.Integer({ minimum: 0, maximum: 4096 })),
    },
    { additionalProperties: false },
  ),
])
const parameterMapSchema = Type.Record(id, publicParameterSchema, { maxProperties: 64, default: {} })
const behaviorDefinitionSchema = Type.Object(
  {
    formatVersion: Type.Literal(1),
    id,
    sourceKind,
    parameters: parameterMapSchema,
    implementation: Type.Union([
      Type.Object({ kind: Type.Literal('rule'), rule: ruleSchema }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('native'), exportId: id }, { additionalProperties: false }),
    ]),
  },
  { additionalProperties: false },
)
const behaviorUseSchema = Type.Object(
  {
    useId: id,
    definitionId: id,
    params: Type.Record(id, scalar, { maxProperties: 64, default: {} }),
  },
  { additionalProperties: false },
)

export type BehaviorParameter = Readonly<Static<typeof publicParameterSchema>>
export type BehaviorDefinition = Readonly<Static<typeof behaviorDefinitionSchema>>
export type BehaviorUse = Readonly<Static<typeof behaviorUseSchema>>
export interface BehaviorOwner {
  readonly kind: 'skill' | 'petMark'
  readonly id: string
}
export interface BehaviorDiagnostic extends CompileDiagnostic {
  readonly useId?: string
}
export class BehaviorCompilationError extends Error {
  constructor(readonly diagnostics: readonly BehaviorDiagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join('; '))
    this.name = 'BehaviorCompilationError'
  }
}

function fail(code: string, contentId: string, field: string, message: string, useId?: string): never {
  throw new BehaviorCompilationError(
    freezeContent([{ code, contentId, field, message: `${code}: ${message}`, ...(useId ? { useId } : {}) }]),
  )
}
/** Bound traversals before schema normalization, including inputs from programmatic hosts. */
function checkSize(input: unknown): void {
  let nodes = 0,
    characters = 0
  const ancestors = new Set<object>()
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 65536 || depth > 40) throw new Error('LIMIT_EXCEEDED: behavior size or depth')
    if (typeof value === 'string') characters += value.length
    if (characters > 1048576) throw new Error('LIMIT_EXCEEDED: behavior text size')
    if (!value || typeof value !== 'object') return
    if (ancestors.has(value)) throw new Error('INVALID_PARAMETERS: cyclic behavior data')
    ancestors.add(value)
    for (const [key, child] of Object.entries(value)) {
      characters += key.length
      visit(child, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(input, 0)
}
function diagnostic(error: unknown, contentId: string, field: string, useId?: string): BehaviorCompilationError {
  if (error instanceof BehaviorCompilationError) return error
  const message = error instanceof Error ? error.message : 'Invalid behavior data'
  const code = message.startsWith('LIMIT_EXCEEDED:') ? 'LIMIT_EXCEEDED' : 'INVALID_PARAMETERS'
  return new BehaviorCompilationError(freezeContent([{ code, contentId, field, useId, message }]))
}
function schemasFor(parameters: Readonly<Record<string, BehaviorParameter>>): Readonly<Record<string, TSchema>> {
  const result: Record<string, TSchema> = Object.create(null)
  for (const [name, parameter] of Object.entries(parameters)) {
    if (parameter.kind === 'number') {
      if (parameter.minimum !== undefined && parameter.maximum !== undefined && parameter.minimum > parameter.maximum)
        throw new Error(`Invalid parameter range: ${name}`)
      result[name] = (parameter.integer ? Type.Integer : Type.Number)({
        default: parameter.default,
        ...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }),
        ...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }),
      })
    } else if (parameter.kind === 'boolean') result[name] = Type.Boolean({ default: parameter.default })
    else
      result[name] = parameter.enum
        ? Type.Intersect(
            [
              Type.Union(parameter.enum.map(value => Type.Literal(value))),
              Type.String({ maxLength: parameter.maxLength ?? 4096 }),
            ],
            { default: parameter.default },
          )
        : Type.String({ default: parameter.default, maxLength: parameter.maxLength ?? 4096 })
  }
  return result
}
function normalizeValues(parameters: Readonly<Record<string, BehaviorParameter>>, input: unknown) {
  const schemas = schemasFor(parameters)
  return normalizeParams(Type.Object({ ...schemas }, { additionalProperties: false }), input) as Readonly<
    Record<string, string | number | boolean>
  >
}
function normalizeDefinition(input: unknown): BehaviorDefinition {
  checkSize(input)
  const definition = normalizeParams(behaviorDefinitionSchema, input)
  normalizeValues(definition.parameters, {})
  if (definition.implementation.kind === 'rule') {
    const rule = definition.implementation.rule
    if (rule.sourceMarkId !== undefined) throw new Error('A reusable rule cannot bind a source mark before use')
    for (const [name, parameter] of Object.entries(definition.parameters)) {
      if (!Object.hasOwn(rule.parameters, name)) throw new Error(`Unknown public rule parameter: ${name}`)
      if (rule.parameters[name].kind !== parameter.kind) throw new Error(`Public rule parameter kind mismatch: ${name}`)
    }
  }
  return definition
}
export function normalizeBehaviorDefinitions(input: unknown): readonly BehaviorDefinition[] {
  try {
    checkSize(input)
    if (!Array.isArray(input) || input.length > 256) throw new Error('Expected at most 256 behavior definitions')
    const seen = new Set<string>()
    return freezeContent(
      input.map(raw => {
        const definition = normalizeDefinition(raw)
        if (seen.has(definition.id)) fail('DUPLICATE_ID', definition.id, 'id', `duplicate behavior ${definition.id}`)
        seen.add(definition.id)
        return definition
      }),
    )
  } catch (error) {
    throw diagnostic(error, '<behaviors>', 'behaviors')
  }
}
export function normalizeBehaviorUses(input: unknown, owner: BehaviorOwner): readonly BehaviorUse[] {
  try {
    checkSize(input)
    if (!Array.isArray(input) || input.length > 64) throw new Error('Expected at most 64 behavior uses')
    const seen = new Set<string>()
    return freezeContent(
      input.map(raw => {
        const use = normalizeParams(behaviorUseSchema, raw)
        if (seen.has(use.useId))
          fail('DUPLICATE_ID', owner.id, 'useId', `duplicate behavior use ${use.useId}`, use.useId)
        seen.add(use.useId)
        return use
      }),
    )
  } catch (error) {
    throw diagnostic(error, owner.id, 'behaviors')
  }
}
export function behaviorEffectId(owner: BehaviorOwner, useId: string): string {
  if (
    typeof owner.id !== 'string' ||
    !owner.id ||
    owner.id.length > 256 ||
    typeof useId !== 'string' ||
    !useId ||
    useId.length > 256 ||
    (owner.kind !== 'skill' && owner.kind !== 'petMark')
  )
    throw new Error('Invalid behavior use identity')
  return `ae:behavior:${JSON.stringify([owner.kind, owner.id, useId])}`
}

export interface NativeBehaviorBuildContext {
  readonly effectId: string
  readonly params: Readonly<Record<string, string | number | boolean>>
  readonly sourceMark?: BaseMark
}
export interface NativeBehaviorExport {
  readonly id: string
  readonly sourceKind: BehaviorOwner['kind']
  readonly parameters: Readonly<Record<string, BehaviorParameter>>
}
interface NativeCompilationContext extends NativeBehaviorBuildContext {
  readonly owner: BehaviorOwner
  readonly parameterSchemas: Readonly<Record<string, TSchema>>
}
const nativeBuilders = new WeakMap<NativeBehaviorExport, (context: NativeCompilationContext) => Effect<EffectTrigger>>()
/** Only host-owned builders can create executable exports; serialized lookalikes are rejected. */
export function defineNativeBehavior<T extends Trigger, P extends Readonly<Record<string, Parameter<unknown>>>>(input: {
  readonly id: string
  readonly sourceKind: BehaviorOwner['kind']
  readonly parameters: Readonly<Record<string, BehaviorParameter>>
  readonly build: (context: NativeBehaviorBuildContext) => EffectDefinition<T, P>
}): NativeBehaviorExport {
  const metadata = normalizeParams(
    Type.Object({ id, sourceKind, parameters: parameterMapSchema }, { additionalProperties: false }),
    { id: input.id, sourceKind: input.sourceKind, parameters: input.parameters },
  )
  normalizeValues(metadata.parameters, {})
  const build = input.build
  if (typeof build !== 'function') throw new Error('Native behavior needs a trusted definition builder')
  const result: NativeBehaviorExport = freezeContent(metadata)
  nativeBuilders.set(result, context => {
    const definition = build(context)
    if (!definition || definition.id !== context.effectId || typeof definition.execute !== 'function')
      throw new Error('Native behavior must build an authored definition with its provided effect identity')
    return compileEffect(definition, {
      source:
        context.owner.kind === 'skill'
          ? { kind: 'skill', id: context.owner.id }
          : { kind: 'petMark', id: context.owner.id, mark: context.sourceMark! },
      parameterSchemas: context.parameterSchemas,
      parameterValues: context.params,
      rejectLegacyAliases: true,
    })
  })
  return result
}
export interface BehaviorCompileOptions {
  readonly owner: BehaviorOwner
  readonly sourceMark?: BaseMark
  readonly registry: CapabilityRegistry
  readonly nativeExports?: readonly NativeBehaviorExport[]
}
export interface PreparedBehaviorUse {
  readonly definition: BehaviorDefinition
  readonly use: BehaviorUse
  readonly effectId: string
}
interface Preparation {
  options: BehaviorCompileOptions
  schemas: Readonly<Record<string, TSchema>>
  native?: NativeBehaviorExport
  rule?: Extract<RuleCompileResult, { ok: true }>
}
const preparations = new WeakMap<PreparedBehaviorUse, Preparation>()
/** Validate all candidates before a host invokes any trusted builder. */
export function validateBehaviorUse(
  definitions: readonly BehaviorDefinition[],
  input: unknown,
  options: BehaviorCompileOptions,
): PreparedBehaviorUse {
  let use: BehaviorUse | undefined
  let field = 'behaviors'
  try {
    use = normalizeBehaviorUses([input], options.owner)[0]
    field = 'definitionId'
    const candidate = definitions.find(candidate => candidate.id === use!.definitionId)
    if (!candidate)
      fail('MISSING_REFERENCE', options.owner.id, field, `unknown behavior ${use.definitionId}`, use.useId)
    const definition = normalizeDefinition(candidate)
    field = 'sourceKind'
    if (
      definition.sourceKind !== options.owner.kind ||
      (options.owner.kind === 'petMark' && options.sourceMark?.id !== options.owner.id) ||
      (options.owner.kind === 'skill' && options.sourceMark)
    )
      fail('CAPABILITY_MISMATCH', options.owner.id, field, 'behavior owner/source mismatch', use.useId)
    field = 'params'
    const params = normalizeValues(definition.parameters, use.params)
    const schemas = schemasFor(definition.parameters)
    let native: NativeBehaviorExport | undefined
    if (definition.implementation.kind === 'native') {
      field = 'implementation.exportId'
      const exports = new Map<string, NativeBehaviorExport>()
      for (const entry of options.nativeExports ?? []) {
        if (exports.has(entry.id))
          fail('DUPLICATE_ID', options.owner.id, field, `duplicate native export ${entry.id}`, use.useId)
        exports.set(entry.id, entry)
      }
      native = exports.get(definition.implementation.exportId)
      if (!native || !nativeBuilders.has(native))
        fail(
          'MISSING_REFERENCE',
          options.owner.id,
          field,
          `unregistered native export ${definition.implementation.exportId}`,
          use.useId,
        )
      if (native.sourceKind !== definition.sourceKind)
        fail('CAPABILITY_MISMATCH', options.owner.id, 'sourceKind', 'native export source mismatch', use.useId)
      // The export owns its public contract. A document cannot widen it or hide required fields.
      const canonical = (value: Readonly<Record<string, BehaviorParameter>>) =>
        JSON.stringify(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, parameter]) => [name, Object.entries(parameter).sort(([a], [b]) => a.localeCompare(b))]),
        )
      if (canonical(native.parameters) !== canonical(definition.parameters))
        fail(
          'INVALID_PARAMETERS',
          options.owner.id,
          'parameters',
          'native public contract does not match its registered export',
          use.useId,
        )
      normalizeValues(native.parameters, params)
    }
    const effectId = behaviorEffectId(options.owner, use.useId)
    let rule: Extract<RuleCompileResult, { ok: true }> | undefined
    if (definition.implementation.kind === 'rule') {
      const candidate = structuredClone(definition.implementation.rule)
      candidate.id = effectId
      for (const [name, value] of Object.entries(params)) candidate.parameters[name].value = value
      const compiled = compileRule(candidate, options.registry, {
        contentId: options.owner.id,
        sourceKind: options.owner.kind,
        sourceMark: options.sourceMark,
        parameterSchemas: schemas,
      })
      if (!compiled.ok)
        throw new BehaviorCompilationError(compiled.diagnostics.map(entry => ({ ...entry, useId: use!.useId })))
      rule = compiled
    }
    const prepared = freezeContent({
      definition,
      use: { ...use, params },
      effectId,
    })
    preparations.set(prepared, { options: { ...options, owner: { ...options.owner } }, schemas, native, rule })
    return prepared
  } catch (error) {
    throw diagnostic(error, options.owner.id, field, use?.useId)
  }
}
export type BehaviorCompileResult =
  | {
      readonly ok: true
      readonly definition: BehaviorDefinition
      readonly use: BehaviorUse
      readonly effect: Effect<EffectTrigger>
      readonly parameters: ParameterCatalog
      readonly rule?: CompiledRuleData
      readonly parameterAddresses: Readonly<Record<string, string>>
    }
  | { readonly ok: false; readonly diagnostics: readonly BehaviorDiagnostic[] }

export function compilePreparedBehaviorUse(prepared: PreparedBehaviorUse): BehaviorCompileResult {
  const plan = preparations.get(prepared)
  if (!plan)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'INVALID_PARAMETERS',
          contentId: '<behavior>',
          field: 'prepared',
          message: 'Unknown prepared behavior use',
        },
      ],
    }
  const { options, schemas, native } = plan
  const { definition, use, effectId } = prepared
  try {
    let effect: Effect<EffectTrigger>, parameters: ParameterCatalog, rule: CompiledRuleData | undefined
    const addresses: Record<string, string> = Object.create(null)
    if (definition.implementation.kind === 'rule') {
      const compiled = plan.rule!
      effect = compiled.effect
      parameters = compiled.parameters
      rule = compiled.rule
      for (const name of Object.keys(definition.parameters))
        addresses[name] = parameterAddress(effectId, rule.parameters[name].nodeId, name)
    } else {
      effect = nativeBuilders.get(native!)!({
        effectId,
        params: use.params,
        sourceMark: options.sourceMark,
        owner: options.owner,
        parameterSchemas: schemas,
      })
      parameters = effectParameters(effect)
      for (const name of Object.keys(definition.parameters))
        addresses[name] = parameterAddress(effectId, 'parameters', name)
    }
    return Object.freeze({
      ok: true,
      definition,
      use,
      effect,
      parameters,
      ...(rule ? { rule } : {}),
      parameterAddresses: freezeContent(addresses),
    })
  } catch (error) {
    return { ok: false, diagnostics: diagnostic(error, options.owner.id, 'implementation', use.useId).diagnostics }
  }
}
export function compileBehaviorUse(
  definition: unknown,
  use: unknown,
  options: BehaviorCompileOptions,
): BehaviorCompileResult {
  try {
    return compilePreparedBehaviorUse(validateBehaviorUse(normalizeBehaviorDefinitions([definition]), use, options))
  } catch (error) {
    return { ok: false, diagnostics: diagnostic(error, options.owner.id, 'behaviors').diagnostics }
  }
}
export function copyBehaviorUse(input: unknown, newUseId: string): BehaviorUse {
  const use = normalizeBehaviorUses([input], { kind: 'skill', id: '<copy>' })[0]
  if (use.useId === newUseId) fail('DUPLICATE_ID', '<copy>', 'useId', 'a copy requires a new use identity', use.useId)
  return normalizeBehaviorUses([{ ...use, useId: newUseId }], { kind: 'skill', id: '<copy>' })[0]
}
export function copyBehaviorDefinition(input: unknown, newId: string): BehaviorDefinition {
  const definition = normalizeBehaviorDefinitions([input])[0]
  if (definition.id === newId) fail('DUPLICATE_ID', newId, 'id', 'a copy requires a new definition identity')
  return normalizeBehaviorDefinitions([{ ...definition, id: newId }])[0]
}
export function encapsulateRule(
  input: unknown,
  options: {
    readonly id: string
    readonly sourceKind: BehaviorOwner['kind']
    readonly parameters: Readonly<Record<string, BehaviorParameter>>
  },
): BehaviorDefinition {
  return normalizeBehaviorDefinitions([
    { formatVersion: 1, ...options, implementation: { kind: 'rule', rule: input } },
  ])[0]
}
export type BehaviorExpansionResult =
  | Extract<RuleCompileResult, { ok: false }>
  | (Extract<RuleCompileResult, { ok: true }> & {
      readonly expandedDefinition: BehaviorDefinition
      readonly expandedUse: BehaviorUse
    })
/** Persist expandedDefinition and expandedUse together: they retain the public parameter contract.
 * The compiled rule is an execution artifact, just as in ordinary behavior compilation.
 * Expansion replaces this use in place; copyBehaviorUse gives a second use an independent identity.
 */
export function expandBehaviorUse(
  definition: unknown,
  use: unknown,
  newRuleId: string,
  options: BehaviorCompileOptions,
): BehaviorExpansionResult {
  try {
    const prepared = validateBehaviorUse(normalizeBehaviorDefinitions([definition]), use, options)
    if (prepared.definition.implementation.kind !== 'rule')
      fail(
        'CAPABILITY_MISMATCH',
        options.owner.id,
        'implementation',
        'native behavior cannot be expanded',
        prepared.use.useId,
      )
    if (
      !newRuleId ||
      newRuleId === prepared.effectId ||
      newRuleId === prepared.definition.id ||
      newRuleId === prepared.definition.implementation.rule.id
    )
      fail('DUPLICATE_ID', options.owner.id, 'id', 'expansion requires a new rule identity', prepared.use.useId)
    const candidate = structuredClone(prepared.definition.implementation.rule)
    candidate.id = newRuleId
    for (const [name, value] of Object.entries(prepared.use.params)) candidate.parameters[name].value = value
    const compiled = compileRule(candidate, options.registry, {
      contentId: options.owner.id,
      sourceKind: options.owner.kind,
      sourceMark: options.sourceMark,
      parameterSchemas: schemasFor(prepared.definition.parameters),
    })
    if (!compiled.ok) return compiled
    const parameters = Object.fromEntries(
      Object.entries(prepared.definition.parameters).map(([name, parameter]) => [
        name,
        { ...parameter, default: prepared.use.params[name] },
      ]),
    )
    const expandedDefinition = normalizeDefinition({
      ...prepared.definition,
      id: newRuleId,
      parameters,
      implementation: { kind: 'rule', rule: candidate },
    })
    const expandedUse = freezeContent({ ...prepared.use, definitionId: newRuleId })
    return Object.freeze({ ...compiled, expandedDefinition, expandedUse })
  } catch (error) {
    return { ok: false, diagnostics: diagnostic(error, options.owner.id, 'expansion').diagnostics }
  }
}
