import { Player } from '@test-battle/battle'
import { PlayerSchema } from '@test-battle/schema'
import { nanoid } from 'nanoid'
import { PetParser } from './pet'

export class PlayerParser {
  static parse(rawData: unknown): Player {
    const validated = PlayerSchema.parse(rawData)
    const uid = validated.id ?? nanoid()

    const pets = validated.team.map(pet => PetParser.parse(pet))

    return new Player(validated.name, uid, pets)
  }
}
