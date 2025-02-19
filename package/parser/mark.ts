import { DataRepository } from 'package/daraRespository/dataRepository'
import { MarkSchema } from 'package/schema/mark'
import { Mark } from 'package/core/mark'
import { Effect, EffectTrigger } from 'package/core/effect'

export class MarkParser {
  static parse(rawData: unknown): Mark {
    const validated = MarkSchema.parse(rawData)

    let effects: Effect<EffectTrigger>[] = []
    if (validated.effect) {
      effects = validated.effect.map(effectId => {
        try {
          return DataRepository.getInstance().getEffect(effectId)
        } catch (e) {
          throw new Error(
            `[MarkParser] Failed to load effect '${effectId}' for mark '${validated.name}': ${(e as Error).message}`,
          )
        }
      })
    }

    return new Mark(validated.id, validated.name, effects, validated.config, validated.tags)
  }
}
