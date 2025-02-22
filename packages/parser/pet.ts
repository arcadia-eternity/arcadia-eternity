import { Mark, Pet, type Species } from '@test-battle/battle'
import { DataRepository } from '@test-battle/data-repository'
import { PetSchema } from '@test-battle/schema'
import { nanoid } from 'nanoid'

export class PetParser {
  static parse(rawData: unknown): Pet {
    const validated = PetSchema.parse(rawData)
    const uid = validated.id ?? nanoid()

    let species: Species
    try {
      species = DataRepository.getInstance().getSpecies(validated.species)
    } catch (e) {
      throw new Error(
        `[PetParser] Failed to load species '${validated.species}' for pet '${validated.name}': ${(e as Error).message}`,
      )
    }

    const skills = validated.skills.map(skillId => {
      try {
        return DataRepository.getInstance().getSkill(skillId)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load effect '${skillId}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    })

    let ability: Mark | undefined
    if (validated.ability) {
      try {
        ability = DataRepository.getInstance().getMark(validated.ability)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load ability '${validated.ability}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    } else if (species.ability && species.ability[0]) ability = species.ability[0]

    let emblem: Mark | undefined
    if (validated.emblem) {
      try {
        emblem = DataRepository.getInstance().getMark(validated.emblem)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load emblem '${validated.emblem}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    }

    return new Pet(
      validated.name,
      uid,
      species,
      validated.level,
      validated.evs,
      validated.ivs,
      validated.nature,
      skills,
      ability,
      emblem,
    )
  }
}
