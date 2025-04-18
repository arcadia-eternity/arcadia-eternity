import { Player } from '@arcadia-eternity/battle'
import { PlayerSchema } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { PetParser } from './pet'
import type { playerId } from '@arcadia-eternity/const'

export class PlayerParser {
  static parse(rawData: unknown): Player {
    const validated = PlayerSchema.parse(rawData)
    const id = validated.id ?? nanoid()

    const pets = validated.team.map(pet => PetParser.parse(pet))

    return new Player(validated.name, id as playerId, pets)
  }
}
