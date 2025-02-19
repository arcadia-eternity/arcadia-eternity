import { Species } from '@test-battle/battle'
import { DataRepository } from '@test-battle/data-repository'
import { SpeciesSchema } from '@test-battle/schema'

export class SpeciesParser {
  static parse(rawData: unknown): Species {
    // 1. 验证基础数据结构
    const validated = SpeciesSchema.parse(rawData)

    const abilities = validated.ability.map(abilitiesID => {
      try {
        return DataRepository.getInstance().getMark(abilitiesID)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] Failed to load effect '${abilitiesID}' for Species '${validated.name}': ${(e as Error).message}`,
        )
      }
    })

    const emblems = validated.emblem.map(emblemsID => {
      try {
        return DataRepository.getInstance().getMark(emblemsID)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] Failed to load effect '${emblemsID}' for Species '${validated.name}': ${(e as Error).message}`,
        )
      }
    })

    return { ...validated, ability: abilities, emblem: emblems }
  }
}
