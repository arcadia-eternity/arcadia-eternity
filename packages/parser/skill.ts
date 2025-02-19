import { DataRepository } from 'packages/daraRespository/dataRepository'
import { SkillSchema } from 'packages/schema/skill'
import { Skill } from '@/battle/skill'
import { Effect } from '@/battle/effect'
import { EffectTrigger } from '@/const/EffectTrigger'

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
      validated.ignoreShield,
      validated.tag,
      effects,
    )
  }
}
