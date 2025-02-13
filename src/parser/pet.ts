import { Pet, Species } from '@/core/pet'
import { DataRepository } from '@/daraRespository/dataRepository'
import { PetSchema } from '@/schema/pet'

export class PetParser {
  static parse(rawData: unknown): Pet {
    const validated = PetSchema.parse(rawData)

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

    return new Pet(validated.name, species, validated.level, validated.evs, validated.ivs, validated.nature, skills)
  }
}
