import { Type } from '@sinclair/typebox'
import { ConfigModifierType, type ConfigSystem, type ScopeObject } from '../../config'
import { defineParameter, parameterAddress, ParameterCatalog, type ParameterDefinition } from '../parameters'

type Options = { default: number | boolean; tags?: readonly string[]; legacyAliases?: readonly string[] }
const declarations = new WeakMap<object, Options>()

/** Own declaration metadata; a reusable parameter gets its address from each containing effect. */
export function declareParameter(parameter: object, options: Options): void {
  if (typeof options.default !== 'boolean' && !Number.isFinite(options.default))
    throw new Error('Expected a finite number or boolean parameter default')
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

  constructor(effectId: string, parameters: Readonly<Record<string, object>>) {
    for (const [name, parameter] of Object.entries(parameters)) {
      const options = declarations.get(parameter)
      if (!options) throw new Error(`Expected an authored parameter: ${name}`)
      if (this.references.has(parameter)) throw new Error('One parameter cannot have multiple names in an effect')
      const numeric = typeof options.default === 'number'
      const definition = defineParameter({
        address: parameterAddress(effectId, 'parameters', name),
        schema: numeric ? Type.Number({ default: options.default }) : Type.Boolean({ default: options.default }),
        effectiveSchema: numeric ? Type.Number() : Type.Boolean(),
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
