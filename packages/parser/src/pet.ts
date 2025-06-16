import { BaseMark, Pet, type Species } from '@arcadia-eternity/battle'
import { Gender, type baseMarkId, type baseSkillId, type petId, type speciesId } from '@arcadia-eternity/const'
import { DataRepository } from '@arcadia-eternity/data-repository'
import { PetSchema } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { fromZodError } from 'zod-validation-error'
import { ZodError } from 'zod'

export class PetParser {
  static parse(rawData: unknown): Pet {
    let validated: ReturnType<typeof PetSchema.parse>
    try {
      validated = PetSchema.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: '[PetParser] 精灵数据验证失败',
          prefixSeparator: ': ',
          issueSeparator: '; ',
        })
        throw new Error(validationError.message)
      }
      throw error
    }
    const uid = validated.id ?? nanoid()

    let species: Species
    try {
      species = DataRepository.getInstance().getSpecies(validated.species as speciesId)
    } catch (e) {
      throw new Error(
        `[PetParser] 精灵 '${validated.name}' 的种族 '${validated.species}' 加载失败: ${(e as Error).message}`,
      )
    }

    const skills = validated.skills.map((skillId, index) => {
      try {
        return DataRepository.getInstance().getSkill(skillId as baseSkillId)
      } catch (e) {
        throw new Error(
          `[PetParser] 精灵 '${validated.name}' 的第 ${index + 1} 个技能 '${skillId}' 加载失败: ${(e as Error).message}`,
        )
      }
    })

    let ability: BaseMark | undefined
    if (validated.ability) {
      try {
        ability = DataRepository.getInstance().getMark(validated.ability as baseMarkId)
      } catch (e) {
        throw new Error(
          `[PetParser] 精灵 '${validated.name}' 的特性 '${validated.ability}' 加载失败: ${(e as Error).message}`,
        )
      }
    } else if (species.ability && species.ability[0]) ability = species.ability[0]

    let emblem: BaseMark | undefined
    if (validated.emblem) {
      try {
        emblem = DataRepository.getInstance().getMark(validated.emblem as baseMarkId)
      } catch (e) {
        throw new Error(
          `[PetParser] 精灵 '${validated.name}' 的纹章 '${validated.emblem}' 加载失败: ${(e as Error).message}`,
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
