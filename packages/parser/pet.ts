import { Pet, Species } from '@/battle/pet'
import { DataRepository } from 'packages/daraRespository/dataRepository'
import { PetSchema } from 'packages/schema/pet'
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

    return new Pet(
      validated.name,
      uid,
      species,
      validated.level,
      validated.evs,
      validated.ivs,
      validated.nature,
      skills,
    )
  }
}
