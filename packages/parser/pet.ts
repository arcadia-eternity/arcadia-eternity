import { BaseMark, MarkInstance, Pet, type Species } from '@test-battle/battle'
import { Gender, type baseMarkId, type baseSkillId, type petId, type speciesId } from '@test-battle/const'
import { DataRepository } from '@test-battle/data-repository'
import { PetSchema } from '@test-battle/schema'
import { nanoid } from 'nanoid'

export class PetParser {
  static parse(rawData: unknown): Pet {
    const validated = PetSchema.parse(rawData)
    const uid = validated.id ?? nanoid()

    let species: Species
    try {
      species = DataRepository.getInstance().getSpecies(validated.species as speciesId)
    } catch (e) {
      throw new Error(
        `[PetParser] Failed to load species '${validated.species}' for pet '${validated.name}': ${(e as Error).message}`,
      )
    }

    const skills = validated.skills.map(skillId => {
      try {
        return DataRepository.getInstance().getSkill(skillId as baseSkillId)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load effect '${skillId}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    })

    let ability: BaseMark | undefined
    if (validated.ability) {
      try {
        ability = DataRepository.getInstance().getMark(validated.ability as baseMarkId)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load ability '${validated.ability}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    } else if (species.ability && species.ability[0]) ability = species.ability[0]

    let emblem: BaseMark | undefined
    if (validated.emblem) {
      try {
        emblem = DataRepository.getInstance().getMark(validated.emblem as baseMarkId)
      } catch (e) {
        throw new Error(
          `[PetParser] Failed to load emblem '${validated.emblem}' for pet '${validated.name}': ${(e as Error).message}`,
        )
      }
    }

    let gender: Gender
    if (!species.genderRatio) gender = Gender.NoGender
    else if (species.genderRatio[0] != 0) gender = Gender.Female
    else gender = Gender.Male

    return new Pet(
      validated.name,
      uid as petId,
      species,
      validated.level,
      validated.evs,
      validated.ivs,
      validated.nature,
      skills,
      ability,
      emblem,
      validated.weight ?? species.weightRange[1],
      validated.height ?? species.heightRange[1],
      gender,
    )
  }
}
