import { BaseSkill, Effect } from '@test-battle/battle'
import { EffectTrigger, type baseSkillId, type effectId } from '@test-battle/const'
import { DataRepository } from '@test-battle/data-repository'
import { SkillSchema } from '@test-battle/schema'
import {} from 'zod'

export class SkillParser {
  static parse(rawData: unknown): BaseSkill {
    const validated = SkillSchema.parse(rawData)

    let effects: Effect<EffectTrigger>[] = []

    if (validated.effect) {
      effects = validated.effect.map(effectId => {
        try {
          return DataRepository.getInstance().getEffect(effectId as effectId)
        } catch (e) {
          throw new Error(
            `[SkillParser] Failed to load effect '${effectId}' for skill '${validated.name}': ${(e as Error).message}`,
          )
        }
      })
    }

    return new BaseSkill(
      validated.id as baseSkillId,
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
      validated.sureCrit,
      validated.ignoreShield,
      validated.tag,
      effects,
    )
  }
}
