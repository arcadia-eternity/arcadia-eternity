import { Species } from '@test-battle/battle'
import type { baseMarkId, speciesId } from '@test-battle/const'
import { DataRepository } from '@test-battle/data-repository'
import { SpeciesSchema } from '@test-battle/schema'

export class SpeciesParser {
  static parse(rawData: unknown): Species {
    // 1. 验证基础数据结构
    const validated = SpeciesSchema.parse(rawData)

    const ability = validated.ability.map(abilityID => {
      try {
        return DataRepository.getInstance().getMark(abilityID as baseMarkId)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] Failed to load effect '${abilityID}' for Species '${validated.name}': ${(e as Error).message}`,
        )
      }
    })

    const emblem = validated.emblem.map(emblemsID => {
      try {
        return DataRepository.getInstance().getMark(emblemsID as baseMarkId)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] Failed to load effect '${emblemsID}' for Species '${validated.name}': ${(e as Error).message}`,
        )
      }
    })

    return new Species({
      id: validated.id as speciesId,
      num: validated.num,
      name: validated.name,
      element: validated.element,
      baseStats: validated.baseStats,
      genderRatio: validated.genderRatio,
      heightRange: validated.heightRange,
      weightRange: validated.weightRange,
      ability: ability,
      emblem: emblem,
    })
  }
}
