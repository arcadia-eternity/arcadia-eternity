import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { effectDSLSchema, parseWithErrors } from '@arcadia-eternity/schema'

import { parseEffect } from './parseEffect'

export { parseEffect }

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    let validated: ReturnType<typeof parseWithErrors<typeof effectDSLSchema>>
    try {
      validated = parseWithErrors(effectDSLSchema, rawData)
    } catch (error) {
      const rawId = rawData != null && typeof rawData === 'object' && 'id' in rawData ? (rawData as Record<string, unknown>).id : undefined
      throw new Error(
        `[EffectParser] 效果数据验证失败${rawId ? ` (${rawId})` : ''}: ${error instanceof Error ? error.message : error}`,
      )
    }

    return parseEffect(validated)
  }
}
