import { Player, AIPlayer } from '../../index'
import { PlayerSchema } from '../schema/player'
import { nanoid } from 'nanoid'
import { PetParser } from './pet'
import type { playerId } from '@arcadia-eternity/const'
import { fromZodError } from 'zod-validation-error'
import { ZodError } from 'zod'
import type { PrototypeLookup } from '../../content/prototype-lookup'
import { DataRepository } from '../dataRepository'

export class PlayerParser {
  static parse(
    rawData: unknown,
    repository: Pick<PrototypeLookup, 'getSpecies' | 'getSkill' | 'getMark'> = DataRepository.getInstance(),
    options: { ai?: boolean } = {},
  ): Player {
    let validated: ReturnType<typeof PlayerSchema.parse>
    try {
      validated = PlayerSchema.parse(rawData)
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error, {
          prefix: '[PlayerParser] 玩家数据验证失败',
          prefixSeparator: ': ',
          issueSeparator: '; ',
        })
        throw new Error(validationError.message)
      }
      throw error
    }
    const id = validated.id ?? nanoid()

    const pets = validated.team.map((pet, index) => {
      try {
        return PetParser.parse(pet, repository)
      } catch (e) {
        throw new Error(
          `[PlayerParser] 玩家 '${validated.name}' 的第 ${index + 1} 只精灵解析失败: ${(e as Error).message}`,
        )
      }
    })

    return options.ai
      ? new AIPlayer(validated.name, id as playerId, pets)
      : new Player(validated.name, id as playerId, pets)
  }
}
