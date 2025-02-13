import { Player } from '@/core/player'
import { PlayerSchema } from '@/schema/player'
import { PetParser } from './pet'

export class PlayerParser {
  static parse(rawData: unknown): Player {
    const validated = PlayerSchema.parse(rawData)

    const pets = validated.team.map(pet => PetParser.parse(pet))

    return new Player(validated.name, validated.uid, pets)
  }
}
