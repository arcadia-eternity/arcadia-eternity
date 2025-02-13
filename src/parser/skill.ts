import { DataRepository } from '@/daraRespository/dataRepository'
import { SkillSchema } from '@/schema/skill'
import { Skill } from '@/core/skill'
import { Effect, EffectTrigger } from '@/core/effect'

export class SkillParser {
  static parse(rawData: unknown): Skill {
    const validated = SkillSchema.parse(rawData)

    let effects: Effect<EffectTrigger>[] = []

    if (validated.effect) {
      effects = validated.effect.map(effectId => {
        try {
          return DataRepository.getInstance().getEffect(effectId)
        } catch (e) {
          throw new Error(
            `[SkillParser] Failed to load effect '${effectId}' for skill '${validated.name}': ${(e as Error).message}`,
          )
        }
      })
    }

    return new Skill(
      validated.id,
      validated.name,
      validated.category,
      validated.element,
      validated.power,
      validated.accuracy,
      validated.rage,
      validated.priority ?? 0,
      validated.target,
      validated.multihit,
      validated.sureHit,
      effects,
    )
  }
}
