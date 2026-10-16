import type { EffectTrigger } from '@arcadia-eternity/const'
import type { EffectReference } from './content.js'
import type { OperationContext } from './context.js'
import type { Mark } from './mark.js'
import type { Skill } from './skill.js'
import type { JsonObject } from './data.js'

/** Temporary trusted execution seam for #205/#223, not a DSL or a template catalog. */
export interface TrustedEffect {
  id: string
  version: string
  triggers: readonly EffectTrigger[]
  priority?: number
  execute(context: OperationContext, source: Skill | Mark, params: JsonObject): void
}
export class EffectRegistry {
  private readonly definitions = new Map<string, TrustedEffect>()
  constructor(definitions: readonly TrustedEffect[] = []) {
    for (const definition of definitions) {
      if (!definition.id || !definition.version || this.definitions.has(definition.id))
        throw new Error('Invalid or duplicate effect registration')
      this.definitions.set(
        definition.id,
        Object.freeze({ ...definition, triggers: Object.freeze([...definition.triggers]) }),
      )
    }
  }
  resolve(ref: EffectReference): TrustedEffect {
    const effect = this.definitions.get(ref.id)
    if (!effect || effect.version !== ref.version)
      throw new Error(`Missing trusted effect version: ${ref.id}@${ref.version}`)
    return effect
  }
}
