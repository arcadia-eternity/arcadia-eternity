import { Effect } from '@test-battle/battle'
import { EffectTrigger } from '@test-battle/const'
import { effectDSLSchema, parseEffect } from '@test-battle/effect-dsl'

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    const validated = effectDSLSchema.parse(rawData)

    return parseEffect(validated)
  }
}
