import type { petId, playerId, PlayerSelection, skillId } from '@arcadia-eternity/const'
import {
  PlayerSelectionSchema,
  parseWithErrors,
  type PlayerSelectionSchemaType as PlayerSelectionSchemaType,
} from '@arcadia-eternity/schema'

export class SelectionParser {
  static parse(rawData: unknown): PlayerSelection {
    const schema = parseWithErrors(PlayerSelectionSchema, rawData)
    switch (schema.type) {
      case 'use-skill':
        return {
          type: 'use-skill',
          player: schema.player as playerId,
          skill: schema.skill as skillId,
          target: schema.target,
        }
      case 'switch-pet':
        return {
          type: 'switch-pet',
          player: schema.player as playerId,
          pet: schema.pet as petId,
        }
      case 'do-nothing':
        return {
          type: 'do-nothing',
          player: schema.player as playerId,
        }
      case 'surrender':
        return {
          type: 'surrender',
          player: schema.player as playerId,
        }
      case 'team-selection':
        return {
          type: 'team-selection',
          player: schema.player as playerId,
          selectedPets: schema.selectedPets as petId[],
          starterPetId: schema.starterPetId as petId,
        }
      default:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw new Error(`未知的选择类型: ${(schema as any).type}`)
    }
  }

  static serialize(selection: PlayerSelection): PlayerSelectionSchemaType {
    switch (selection.type) {
      case 'use-skill':
        return {
          type: 'use-skill',
          player: selection.player, // 注意字段名与 schema 一致
          skill: selection.skill,
          target: selection.target,
        }
      case 'switch-pet':
        return {
          type: 'switch-pet',
          player: selection.player,
          pet: selection.pet,
        }
      case 'do-nothing':
      case 'surrender':
        return {
          type: selection.type,
          player: selection.player,
        }
      case 'team-selection':
        return {
          type: 'team-selection',
          player: selection.player,
          selectedPets: selection.selectedPets,
          starterPetId: selection.starterPetId,
        }
      default: {
        // 类型保护，确保处理所有可能类型
        const _exhaustiveCheck: never = selection
        throw new Error(`未知的选择类型: ${_exhaustiveCheck}`)
      }
    }
  }
}
