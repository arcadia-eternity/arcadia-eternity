import { Effect, EffectTrigger } from '@/core/effect'
import { parseEffect } from '@/effectDSL/parse'
import { effectDSLSchema } from '@/effectDSL/dslSchema'

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    const validated = effectDSLSchema.parse(rawData)

    return parseEffect(validated)
  }
}
