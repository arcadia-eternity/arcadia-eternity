import { PlayerSelection } from '@/core/selection'
import { PlayerSelectionSchema } from '@/schema/selection'

export class SelectionParser {
  static parse(rawData: unknown): PlayerSelection {
    const schema = PlayerSelectionSchema.parse(rawData)
    switch (schema.type) {
      case 'use-skill':
        return {
          type: 'use-skill',
          player: schema.source,
          skill: schema.skill,
          target: schema.target,
        }
      case 'switch-pet':
        return {
          type: 'switch-pet',
          player: schema.source,
          pet: schema.pet,
        }
      case 'do-nothing':
        return {
          type: 'do-nothing',
          player: schema.source,
        }
      case 'surrender':
        return {
          type: 'surrender',
          player: schema.source,
        }
      default:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw new Error(`未知的选择类型: ${(schema as any).type}`)
    }
  }
}
