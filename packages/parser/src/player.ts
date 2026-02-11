import { Player } from '@arcadia-eternity/battle'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { PetParser } from './pet'
import type { playerId } from '@arcadia-eternity/const'

export class PlayerParser {
  static parse(rawData: unknown): Player {
    let validated: ReturnType<typeof parseWithErrors<typeof PlayerSchema>>
    try {
      validated = parseWithErrors(PlayerSchema, rawData)
    } catch (error) {
      throw new Error(
        `[PlayerParser] 玩家数据验证失败: ${error instanceof Error ? error.message : error}`,
      )
    }
    const id = validated.id ?? nanoid()

    const pets = validated.team.map((pet, index) => {
      try {
        return PetParser.parse(pet)
      } catch (e) {
        throw new Error(
          `[PlayerParser] 玩家 '${validated.name}' 的第 ${index + 1} 只精灵解析失败: ${(e as Error).message}`,
        )
      }
    })

    return new Player(validated.name, id as playerId, pets)
  }
}
