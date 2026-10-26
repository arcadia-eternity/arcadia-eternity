import { Type, type TSchema } from '@sinclair/typebox'
import { ConfigModifierType, type ConfigSystem, type ScopeObject } from '../../config'
import { defineParameter, parameterAddress, ParameterCatalog, type ParameterDefinition } from '../parameters'

type Options = { default: number | boolean | string; tags?: readonly string[]; legacyAliases?: readonly string[] }
const declarations = new WeakMap<object, Options>()

/** Own declaration metadata; a reusable parameter gets its address from each containing effect. */
export function declareParameter(parameter: object, options: Options): void {
  if (typeof options.default !== 'boolean' && typeof options.default !== 'string' && !Number.isFinite(options.default))
    throw new Error('Expected a finite scalar parameter default')
  declarations.set(parameter, {
    default: options.default,
    tags: [...(options.tags ?? [])],
    legacyAliases: [...(options.legacyAliases ?? [])],
  })
}

/** Reuses the existing configuration contracts; contains no per-battle values. */
export class AuthoringParameters {
  readonly catalog: ParameterCatalog
  private readonly references = new Map<object, ParameterDefinition>()

  constructor(
    effectId: string,
    parameters: Readonly<Record<string, object>>,
    contracts: {
      readonly parameterSchemas?: Readonly<Record<string, TSchema>>
      readonly rejectLegacyAliases?: boolean
      readonly parameterValues?: Readonly<Record<string, string | number | boolean>>
    } = {},
  ) {
    for (const name of Object.keys(contracts.parameterSchemas ?? {}))
      if (!Object.hasOwn(parameters, name)) throw new Error(`Missing authored public parameter: ${name}`)
    for (const [name, parameter] of Object.entries(parameters)) {
      const options = declarations.get(parameter)
      if (!options) throw new Error(`Expected an authored parameter: ${name}`)
      if (
        contracts.parameterValues &&
        Object.hasOwn(contracts.parameterValues, name) &&
        contracts.parameterValues[name] !== options.default
      )
        throw new Error(`Authored public parameter does not match its use: ${name}`)
      if (contracts.rejectLegacyAliases && options.legacyAliases?.length)
        throw new Error(`Behavior parameters cannot expose legacy aliases: ${name}`)
      if (this.references.has(parameter)) throw new Error('One parameter cannot have multiple names in an effect')
      const numeric = typeof options.default === 'number'
      const schema = numeric ? Type.Number() : typeof options.default === 'string' ? Type.String() : Type.Boolean()
      const definition = defineParameter({
        address: parameterAddress(effectId, 'parameters', name),
        schema: contracts.parameterSchemas?.[name] ?? { ...schema, default: options.default },
        effectiveSchema: contracts.parameterSchemas?.[name] ?? schema,
        value: options.default,
        operations: numeric ? [ConfigModifierType.delta, ConfigModifierType.override] : [ConfigModifierType.override],
        aliases: [...(options.legacyAliases ?? [])],
        tags: [...(options.tags ?? [])],
      })
      this.references.set(parameter, definition)
    }
    this.catalog = new ParameterCatalog([...this.references.values()])
  }

  read(parameter: object, config: ConfigSystem, source: ScopeObject): unknown {
    const definition = this.references.get(parameter)
    if (!definition) throw new Error('Parameter is not declared by this effect')
    return this.catalog.read(config, definition, source)
  }
}
