import { type Species } from '../../index'
import type { baseMarkId, speciesId } from '@arcadia-eternity/const'
import { DataRepository } from '../dataRepository'
import { SpeciesSchema } from '../schema/species'
import { fromZodError } from 'zod-validation-error'
import { ZodError } from 'zod'
import type { PrototypeLookup } from '../../content/prototype-lookup'

export class SpeciesParser {
  static parse(rawData: unknown, repository: Pick<PrototypeLookup, 'getMark'> = DataRepository.getInstance()): Species {
    // 1. 验证基础数据结构
    let validated: ReturnType<typeof SpeciesSchema.parse>
    try {
      validated = SpeciesSchema.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: '[SpeciesParser] 种族数据验证失败',
          prefixSeparator: ': ',
          issueSeparator: '; ',
        })
        throw new Error(validationError.message)
      }
      throw error
    }

    const ability = validated.ability.map((abilityID, index) => {
      try {
        return repository.getMark(abilityID as baseMarkId)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] 种族 '${validated.id}' 的第 ${index + 1} 个特性 '${abilityID}' 加载失败: ${(e as Error).message}`,
        )
      }
    })

    const emblems = validated.emblem.map((emblemsID, index) => {
      try {
        return repository.getMark(emblemsID as baseMarkId)
      } catch (e) {
        throw new Error(
          `[SpeciesParser] 种族 '${validated.id}' 的第 ${index + 1} 个纹章 '${emblemsID}' 加载失败: ${(e as Error).message}`,
        )
      }
    })

    return { ...validated, id: validated.id as speciesId, ability: ability, emblem: emblems }
  }
}
