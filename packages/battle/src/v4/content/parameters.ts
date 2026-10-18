import { Kind, type Static, type TObject, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { ConfigSystem, ConfigModifier, ConfigModifierType, type ScopeObject } from '../config'

type Scalar = string | number | boolean
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value
}
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || ancestors.has(value))
    throw new Error('Parameters must be finite JSON data')
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error('Parameters must be plain JSON data')
  ancestors.add(value)
  for (const key of Object.keys(value)) {
    if (key === '__proto__') throw new Error('Invalid parameter name')
    assertJson(Reflect.get(value, key), ancestors)
  }
  ancestors.delete(value)
}

function assertClosedObjects(schema: TObject): void {
  const visited = new WeakSet<object>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || visited.has(node)) return
    visited.add(node)
    if (Reflect.get(node, Kind) === 'Object' && Reflect.get(node, 'additionalProperties') !== false)
      throw new Error('Parameter object schemas must reject unknown fields')
    // Walk schema compositions and property maps, without interpreting their types.
    for (const child of Object.values(node)) visit(child)
  }
  visit(schema)
}

/** One schema controls defaults, validation, editor metadata and the inferred TS shape. */
export function normalizeParams<S extends TObject>(schema: S, input: unknown): Readonly<Static<S>> {
  assertClosedObjects(schema)
  assertJson(input)
  const result: unknown = Value.Default(schema, Value.Clone(input))
  assertJson(result)
  if (!Value.Check(schema, result)) throw new Error('Invalid content parameters')
  return freeze(result)
}

export function parameterAddress(effectId: string, nodeId: string, parameterId: string): string {
  if (![effectId, nodeId, parameterId].every(part => typeof part === 'string' && part.length > 0))
    throw new Error('Parameter address needs effect, node and parameter identities')
  return `ae:param:${JSON.stringify([effectId, nodeId, parameterId])}`
}
export interface ParameterDefinition<S extends TSchema = TSchema, E extends TSchema = TSchema> {
  readonly address: string
  readonly schema: S
  readonly effectiveSchema: E
  readonly value: Static<S>
  readonly operations: readonly ConfigModifierType[]
  readonly aliases: readonly string[]
  readonly tags: readonly string[]
}
function assertScalarSchema(schema: TSchema): void {
  if (['Number', 'Integer', 'String', 'Boolean', 'Literal'].includes(schema[Kind])) return
  if (schema[Kind] === 'Union' && Array.isArray(schema.anyOf)) {
    for (const member of schema.anyOf) assertScalarSchema(member as TSchema)
    return
  }
  throw new Error('Public battle parameters require scalar schemas')
}
function scalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  )
}
/** A finite operation-domain check, not schema subtyping or range inference. */
function supportsOperation(schema: TSchema, operation: ConfigModifierType): boolean {
  if (operation === ConfigModifierType.override) return true
  if (schema[Kind] === 'Union') return (schema.anyOf as TSchema[]).every(member => supportsOperation(member, operation))
  const kind = schema[Kind] === 'Literal' ? typeof schema.const : schema.type
  if (operation === ConfigModifierType.delta) return kind === 'number' || kind === 'integer'
  if (operation === ConfigModifierType.append || operation === ConfigModifierType.prepend) return kind === 'string'
  return false
}
export function defineParameter<S extends TSchema, E extends TSchema>(input: {
  address: string
  schema: S
  effectiveSchema: E
  value?: Static<S>
  operations: readonly ConfigModifierType[]
  aliases?: readonly string[]
  tags?: readonly string[]
}): ParameterDefinition<S, E> {
  if (!input.address) throw new Error('Missing parameter address')
  assertScalarSchema(input.schema)
  assertScalarSchema(input.effectiveSchema)
  for (const operation of input.operations)
    if (!supportsOperation(input.effectiveSchema, operation))
      throw new Error(`Incompatible parameter operation: ${operation} for ${input.address}`)
  const value: unknown = input.value === undefined ? input.schema.default : input.value
  if (!scalar(value) || !Value.Check(input.schema, value) || !Value.Check(input.effectiveSchema, value))
    throw new Error(`Invalid base parameter: ${input.address}`)
  return freeze({
    ...input,
    schema: Value.Clone(input.schema),
    effectiveSchema: Value.Clone(input.effectiveSchema),
    value,
    operations: [...input.operations],
    aliases: [...(input.aliases ?? [])],
    tags: [...(input.tags ?? [])],
  })
}

/** Immutable content-side addresses. Values and modifiers live in the existing per-battle ConfigSystem. */
export class ParameterCatalog {
  private readonly definitions = new Map<string, ParameterDefinition>()
  private readonly aliases = new Map<string, string>()
  private readonly references = new WeakMap<ParameterDefinition, ParameterDefinition>()
  constructor(definitions: readonly ParameterDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.address))
        throw new Error(`Duplicate parameter address: ${definition.address}`)
      const copy = defineParameter(definition)
      this.definitions.set(copy.address, copy)
      this.references.set(definition, copy)
    }
    for (const definition of this.definitions.values())
      for (const alias of definition.aliases) {
        if (!alias || this.definitions.has(alias) || this.aliases.has(alias))
          throw new Error(`Ambiguous parameter alias: ${alias}`)
        this.aliases.set(alias, definition.address)
      }
  }
  private resolve(reference: string | ParameterDefinition): ParameterDefinition {
    const key = typeof reference === 'string' ? reference : reference.address
    const definition =
      typeof reference === 'string'
        ? this.definitions.get(this.aliases.get(key) ?? key)
        : this.references.get(reference)
    if (!definition) throw new Error(`Unknown parameter: ${key}`)
    return definition
  }
  install(config: ConfigSystem): void {
    if (config.isDisposed) throw new Error('Cannot install parameters into disposed config')
    // Check the whole candidate before mutating any existing battle configuration.
    for (const definition of this.definitions.values())
      if (config.hasRegisteredConfig(definition.address))
        throw new Error(`Parameter already registered: ${definition.address}`)
    for (const definition of this.definitions.values())
      config.registerTaggedConfig(definition.address, definition.value as Scalar, [...definition.tags])
  }
  read<S extends TSchema, E extends TSchema>(
    config: ConfigSystem,
    reference: ParameterDefinition<S, E>,
    scope?: ScopeObject,
  ): Static<E>
  read(config: ConfigSystem, reference: string, scope?: ScopeObject): Scalar
  read(config: ConfigSystem, reference: string | ParameterDefinition, scope?: ScopeObject): Scalar {
    const definition = this.resolve(reference)
    const value = config.get(definition.address, scope)
    if (!scalar(value) || !Value.Check(definition.effectiveSchema, value))
      throw new Error(`Invalid effective parameter: ${definition.address}`)
    return value
  }
  /** The returned cleanup must be attached to the operation's source/phase lifetime by its caller. */
  modify(
    config: ConfigSystem,
    reference: string | ParameterDefinition,
    modifier: ConfigModifier,
    scope?: ScopeObject,
  ): () => void {
    const definition = this.resolve(reference)
    if (!definition.operations.includes(modifier.type))
      throw new Error(`Unsupported parameter operation: ${modifier.type}`)
    return config.addScopedConfigModifier(definition.address, modifier, scope)
  }
}
