import { Effect } from '@/battle/effect'
import { EffectTrigger } from '@/const/EffectTrigger'
import { parseEffect } from 'packages/effectDSL/parse'
import { effectDSLSchema } from 'packages/effectDSL/dslSchema'

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    const validated = effectDSLSchema.parse(rawData)

    return parseEffect(validated)
  }
}
