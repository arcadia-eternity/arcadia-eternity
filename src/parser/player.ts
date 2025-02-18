import { Player } from '@/core/player'
import { PlayerSchema } from '@/schema/player'
import { PetParser } from './pet'
import { nanoid } from 'nanoid'

export class PlayerParser {
  static parse(rawData: unknown): Player {
    const validated = PlayerSchema.parse(rawData)
    const uid = validated.id ?? nanoid()

    const pets = validated.team.map(pet => PetParser.parse(pet))

    return new Player(validated.name, uid, pets)
  }
}
