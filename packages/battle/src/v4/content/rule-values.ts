import { Type, type Static, type TObject, type TSchema } from '@sinclair/typebox'
import { Value as SchemaValue } from '@sinclair/typebox/value'
import type { Pet } from '../pet'
import type { MarkInstance } from '../mark'
import type * as A from './authoring/contracts'
import type { CapabilityNeed } from './capabilities'
import { isCapabilityNeed } from './capabilities'
import type { EffectSourceKind } from './triggers'
import { normalizeParams } from './parameters'
import { freezeContent } from './immutable'

/** Closed categories: a selected entity, its current property and a persistent plan are different slots. */
export interface RuleValueTypes {
  selectorPet: A.Selector<Pet>
  selectorMark: A.Selector<MarkInstance>
  valuePet: A.Value<Pet, A.Presence>
  valueMark: A.Value<MarkInstance, A.Presence>
  number: A.Value<number, A.Presence>
  boundPet: A.BindingValue<Pet, A.Presence>
  boundMark: A.BindingValue<MarkInstance, A.Presence>
  boundNumber: A.BindingValue<number, A.Presence>
}
export type RuleValueCategory = keyof RuleValueTypes
export type RuleInputSlots = Readonly<Record<string, RuleValueCategory>>
type Inputs<I extends RuleInputSlots> = { readonly [K in keyof I]: RuleValueTypes[I[K]] }
const categories = new Set<RuleValueCategory>([
  'selectorPet',
  'selectorMark',
  'valuePet',
  'valueMark',
  'number',
  'boundPet',
  'boundMark',
  'boundNumber',
])
const sourceKinds = new Set<EffectSourceKind>(['skill', 'petMark', 'battleMark'])
export interface RuleCapabilityMetadata {
  readonly id: string
  readonly params: TObject
  readonly inputs: RuleInputSlots
  readonly inputSchemas: Readonly<Record<string, TSchema>>
  readonly needs: readonly CapabilityNeed[]
  readonly sourceKinds: readonly EffectSourceKind[]
  /** Editor contract; implementations must use the native authoring missing-input semantics. */
  readonly missing: 'empty' | 'skip' | 'detach'
  readonly temporal: 'immediate' | 'follow' | 'capture-binding' | 'attribute-step' | 'combine'
}
export interface RegisteredRuleValue extends RuleCapabilityMetadata {
  readonly output: RuleValueCategory
  readonly build: (
    key: string,
    params: unknown,
    inputs: Readonly<Record<string, unknown>>,
  ) => RuleValueTypes[RuleValueCategory]
}
export interface RegisteredRuleOperation extends RuleCapabilityMetadata {
  readonly build: (key: string, params: unknown, inputs: Readonly<Record<string, unknown>>) => A.Action
}
const registeredValues = new WeakSet<RegisteredRuleValue>()
const registeredOperations = new WeakSet<RegisteredRuleOperation>()
export function isRegisteredRuleValue(value: RegisteredRuleValue): boolean {
  return registeredValues.has(value)
}
export function isRegisteredRuleOperation(value: RegisteredRuleOperation): boolean {
  return registeredOperations.has(value)
}
interface Definition<S extends TObject, I extends RuleInputSlots> {
  readonly id: string
  readonly params: S
  readonly inputs: I
  readonly inputSchemas?: Readonly<Partial<Record<keyof I, TSchema>>>
  readonly needs: readonly CapabilityNeed[]
  readonly sourceKinds?: readonly EffectSourceKind[]
  readonly missing: RuleCapabilityMetadata['missing']
  readonly temporal?: RuleCapabilityMetadata['temporal']
}
function metadata<S extends TObject, I extends RuleInputSlots>(definition: Definition<S, I>): RuleCapabilityMetadata {
  const kinds: readonly EffectSourceKind[] = definition.sourceKinds ?? ['skill', 'petMark']
  if (
    !definition.id ||
    definition.needs.some(need => !isCapabilityNeed(need)) ||
    new Set(definition.needs).size !== definition.needs.length ||
    kinds.some(kind => !sourceKinds.has(kind)) ||
    new Set(kinds).size !== kinds.length ||
    Object.values(definition.inputs).some(type => !categories.has(type))
  )
    throw new Error('Invalid rule capability contract')
  for (const field of Object.keys(definition.inputSchemas ?? {}))
    if (definition.inputs[field] !== 'number') throw new Error('Only numeric immediate slots accept scalar schemas')
  return freezeContent({
    id: definition.id,
    params: SchemaValue.Clone(definition.params),
    inputs: { ...definition.inputs },
    inputSchemas: SchemaValue.Clone(definition.inputSchemas ?? {}) as Record<string, TSchema>,
    needs: [...definition.needs],
    sourceKinds: [...kinds],
    missing: definition.missing,
    temporal: definition.temporal ?? 'immediate',
  })
}
/** Trusted host registration. Serialized rules contain IDs and data only. */
export function defineRuleValue<S extends TObject, const I extends RuleInputSlots, K extends RuleValueCategory>(
  definition: Definition<S, I> & {
    readonly output: K
    readonly build: (context: {
      readonly key: string
      readonly params: Readonly<Static<S>>
      readonly inputs: Inputs<I>
    }) => RuleValueTypes[K]
  },
): RegisteredRuleValue {
  if (!categories.has(definition.output)) throw new Error('Invalid rule value output category')
  const contract = metadata(definition),
    build = definition.build
  const value: RegisteredRuleValue = Object.freeze({
    ...contract,
    output: definition.output,
    build: (key: string, params: unknown, inputs: Readonly<Record<string, unknown>>) =>
      build({ key, params: params as Readonly<Static<S>>, inputs: inputs as Inputs<I> }),
  })
  registeredValues.add(value)
  return value
}
export function defineRuleOperation<S extends TObject, const I extends RuleInputSlots>(
  definition: Definition<S, I> & {
    readonly build: (context: {
      readonly key: string
      readonly params: Readonly<Static<S>>
      readonly inputs: Inputs<I>
    }) => A.Action
  },
): RegisteredRuleOperation {
  const contract = metadata(definition),
    build = definition.build
  const operation: RegisteredRuleOperation = Object.freeze({
    ...contract,
    build: (key: string, params: unknown, inputs: Readonly<Record<string, unknown>>) =>
      build({ key, params: params as Readonly<Static<S>>, inputs: inputs as Inputs<I> }),
  })
  registeredOperations.add(operation)
  return operation
}
export const ruleInputReferenceSchema = Type.Union([
  Type.Object({ node: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ parameter: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ instanceParameter: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
])
export const ruleInputsSchema = Type.Record(Type.String({ minLength: 1 }), ruleInputReferenceSchema, {
  maxProperties: 8,
})
export const ruleValueNodeSchema = Type.Object(
  {
    nodeId: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    params: Type.Unknown({ default: {} }),
    inputs: Type.Optional(ruleInputsSchema),
  },
  { additionalProperties: false },
)
export type RuleValueNode = Static<typeof ruleValueNodeSchema>
export type RuleInputReference = Static<typeof ruleInputReferenceSchema>

export class RuleSlotError extends Error {
  constructor(
    readonly nodeId: string | undefined,
    readonly field: string,
    message: string,
  ) {
    super(message)
  }
}
/** Preserve the exact JSON field for the author rather than reducing schema errors to a message. */
export function normalizeRuleCapabilityParams(
  contract: RuleCapabilityMetadata,
  input: unknown,
  nodeId: string,
  field: string,
): unknown {
  try {
    return normalizeParams(contract.params, input)
  } catch (error) {
    const defaults = SchemaValue.Default(contract.params, SchemaValue.Clone(input))
    const issue = SchemaValue.Errors(contract.params, defaults).First()
    throw new RuleSlotError(
      nodeId,
      `${field}${issue?.path ?? ''}`,
      error instanceof Error ? error.message : 'Invalid parameters',
    )
  }
}
