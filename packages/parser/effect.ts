import { Effect, EffectTrigger } from 'packages/core/effect'
import { parseEffect } from 'packages/effectDSL/parse'
import { effectDSLSchema } from 'packages/effectDSL/dslSchema'

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    const validated = effectDSLSchema.parse(rawData)

    return parseEffect(validated)
  }
}
