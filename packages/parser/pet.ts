import { Mark, Pet, Species } from '@test-battle/battle'
import { DataRepository } from '@test-battle/data-repository'
import { PetSchema } from '@test-battle/schema'
import { nanoid } from 'nanoid'

export class PetParser {
  static parse(rawData: unknown): Pet {
    const validated = PetSchema.parse(rawData)
    const uid = validated.uid ?? nanoid()

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

    let abilities: Mark | undefined
    if (validated.abilities) {
      try {
        abilities = DataRepository.getInstance().getMark(validated.abilities)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load abilities '${validated.abilities}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    }

    let emblem: Mark | undefined
    if (validated.emblem) {
      try {
        emblem = DataRepository.getInstance().getMark(validated.emblem)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load abilities '${validated.emblem}' for pet '${validated.name}': ${(e as Error).message}`,
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
      abilities,
      emblem,
    )
  }
}
