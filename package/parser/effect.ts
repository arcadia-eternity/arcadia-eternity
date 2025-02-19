import { Effect, EffectTrigger } from 'package/core/effect'
import { parseEffect } from 'package/effectDSL/parse'
import { effectDSLSchema } from 'package/effectDSL/dslSchema'

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    const validated = effectDSLSchema.parse(rawData)

    return parseEffect(validated)
  }
}
