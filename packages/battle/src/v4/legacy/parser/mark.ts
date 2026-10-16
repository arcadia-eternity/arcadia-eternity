import { BaseMark, Effect } from '../../index'
import { EffectTrigger, type baseMarkId, type effectId } from '@arcadia-eternity/const'
import { DataRepository } from '../dataRepository'
import { MarkSchema } from '../schema/index'

export class MarkParser {
  static parse(rawData: unknown): BaseMark {
    const validated = MarkSchema.parse(rawData)

    let effects: Effect<EffectTrigger>[] = []
    if (validated.effect) {
      effects = validated.effect.map(effectId => {
        try {
          return DataRepository.getInstance().getEffect(effectId as effectId)
        } catch (e) {
          throw new Error(
            `[MarkParser] Failed to load effect '${effectId}' for mark '${validated.id}': ${(e as Error).message}`,
          )
        }
      })
    }

    return new BaseMark(validated.id as baseMarkId, effects, validated.config, validated.tags)
  }
}
