import type { petId, playerId, PlayerSelection, skillId } from '@test-battle/const'
import { PlayerSelectionSchema, type PlayerSelectionSchemaType as PlayerSelectionSchemaType } from '@test-battle/schema'

export class SelectionParser {
  static parse(rawData: unknown): PlayerSelection {
    const schema = PlayerSelectionSchema.parse(rawData)
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
      default: {
        // 类型保护，确保处理所有可能类型
        const _exhaustiveCheck: never = selection
        throw new Error(`未知的选择类型: ${_exhaustiveCheck}`)
      }
    }
  }
}
