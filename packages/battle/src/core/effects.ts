import type { TrustedValue, ComputedReference } from './values.js'
import type { EffectTrigger } from '@arcadia-eternity/const'
import type { EffectReference } from './content.js'
import type { EffectContext } from './context.js'
import type { Prototype } from './entity.js'

/** The trigger generic binds callback.parent to TriggerContextMap[trigger]. */
export interface TrustedEffect<T extends EffectTrigger = EffectTrigger> extends Prototype {
  version: string
  triggers: readonly T[]
  priority?: number
  execute(context: EffectContext<NoInfer<T>>): void
}
export function defineEffect<T extends EffectTrigger>(definition: TrustedEffect<T>): TrustedEffect<T> {
  return definition
}
export class EffectRegistry {
  private readonly values = new Map<string, TrustedValue>()
  private readonly definitions = new Map<string, TrustedEffect>()
  constructor(definitions: readonly TrustedEffect[] = [], values: readonly TrustedValue[] = []) {
    for (const value of values) {
      if (!value.id || !value.version || this.values.has(value.id))
        throw new Error('Invalid or duplicate trusted value')
      this.values.set(value.id, Object.freeze({ ...value }))
    }
    for (const definition of definitions) {
      if (!definition.id || !definition.version || this.definitions.has(definition.id))
        throw new Error('Invalid or duplicate effect registration')
      this.definitions.set(
        definition.id,
        Object.freeze({ ...definition, triggers: Object.freeze([...definition.triggers]) }),
      )
    }
  }
  resolveValue(ref: ComputedReference): TrustedValue {
    const value = this.values.get(ref.id)
    if (!value || value.version !== ref.version)
      throw new Error(`Missing trusted value version: ${ref.id}@${ref.version}`)
    return value
  }
  resolve(ref: EffectReference): TrustedEffect {
    const effect = this.definitions.get(ref.id)
    if (!effect || effect.version !== ref.version)
      throw new Error(`Missing trusted effect version: ${ref.id}@${ref.version}`)
    return effect
  }
}
