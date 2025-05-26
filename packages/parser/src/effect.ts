import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { effectDSLSchema } from '@arcadia-eternity/schema'

import { parseEffect } from './parseEffect'

export { parseEffect }

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    const validated = effectDSLSchema.parse(rawData)

    return parseEffect(validated)
  }
}
