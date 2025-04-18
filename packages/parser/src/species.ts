import { type Species } from '@arcadia-eternity/battle'
import type { baseMarkId, speciesId } from '@arcadia-eternity/const'
import { DataRepository } from '@arcadia-eternity/data-repository'
import { SpeciesSchema } from '@arcadia-eternity/schema'

export class SpeciesParser {
  static parse(rawData: unknown): Species {
    // 1. 验证基础数据结构
    const validated = SpeciesSchema.parse(rawData)

    const ability = validated.ability.map(abilityID => {
      try {
        return DataRepository.getInstance().getMark(abilityID as baseMarkId)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] Failed to load effect '${abilityID}' for Species '${validated.id}': ${(e as Error).message}`,
        )
      }
    })

    const emblems = validated.emblem.map(emblemsID => {
      try {
        return DataRepository.getInstance().getMark(emblemsID as baseMarkId)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] Failed to load effect '${emblemsID}' for Species '${validated.id}': ${(e as Error).message}`,
        )
      }
    })

    return { ...validated, id: validated.id as speciesId, ability: ability, emblem: emblems }
  }
}
