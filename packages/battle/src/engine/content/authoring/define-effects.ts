import type { EffectTrigger } from '@arcadia-eternity/const'
import type { Effect } from '../../effect'
import type { EffectDefinition, Parameter, Trigger } from './contracts'
import { compileEffect } from './runtime'

type Parameters = Readonly<Record<string, Parameter<unknown>>>
type EmptyParameters = Record<never, never>
type ParametersFor<P, Id> = Id extends keyof P ? (P[Id] extends Parameters ? P[Id] : EmptyParameters) : EmptyParameters
type Definition<T extends Trigger, P extends Parameters> = Omit<EffectDefinition<T, NoInfer<P>>, 'id'>

/** Compile each definition under its record key, then freeze the executable effect table. */
export function defineEffects<const T extends Record<string, Trigger>, const P = EmptyParameters>(
  definitions: { [Id in keyof T]: Definition<T[Id], ParametersFor<P, Id>> } & {
    [Id in keyof P]: { readonly parameters?: P[Id] & Parameters }
  },
): Readonly<Record<keyof T, Effect<EffectTrigger>>>
export function defineEffects(definitions: object) {
  const entries: [string, Definition<Trigger, Parameters> & { readonly id?: string }][] = Object.entries(definitions)
  const effects = entries.map(([id, definition]) => {
    const declaredId = definition.id
    if (declaredId === undefined) return [id, compileEffect({ ...definition, id })] as const
    if (declaredId !== id) throw new Error(`Effect ID ${declaredId} does not match its group key ${id}`)
    return [id, compileEffect(definition as EffectDefinition<Trigger, Parameters>)] as const
  })
  return Object.freeze(Object.fromEntries(effects))
}
