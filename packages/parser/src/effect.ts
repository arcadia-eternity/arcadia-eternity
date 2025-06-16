import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { effectDSLSchema } from '@arcadia-eternity/schema'
import { fromZodError } from 'zod-validation-error'
import { ZodError } from 'zod'

import { parseEffect } from './parseEffect'

export { parseEffect }

export class EffectParser {
  static parse(rawData: unknown): Effect<EffectTrigger> {
    let validated: ReturnType<typeof effectDSLSchema.parse>
    try {
      validated = effectDSLSchema.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: '[EffectParser] 效果数据验证失败' + ((rawData as any).id || '未知'),
          prefixSeparator: ': ',
          issueSeparator: '; ',
        })
        throw new Error(validationError.message)
      }
      throw error
    }

    return parseEffect(validated)
  }
}
