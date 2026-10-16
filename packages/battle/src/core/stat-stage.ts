import { StackStrategy } from '@arcadia-eternity/const'
import type { BaseMark } from './content.js'
import type { StageStat } from './pet.js'

export const STAGE_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const
export function parseStageMark(id: string): { stat: StageStat; sign: number } | null {
  const match = /^stat_stage_(atk|def|spa|spd|spe)_(up|down)$/.exec(id)
  return match ? { stat: match[1] as StageStat, sign: match[2] === 'up' ? 1 : -1 } : null
}
export function stageMark(id: string): BaseMark | null {
  if (!parseStageMark(id)) return null
  return {
    id,
    effects: [],
    tags: ['statStage'],
    config: {
      duration: -1,
      persistent: true,
      maxStacks: 6,
      stackable: true,
      stackStrategy: StackStrategy.stack,
      destroyable: true,
      isShield: false,
      keepOnSwitchOut: true,
      transferOnSwitch: false,
      inheritOnFaint: false,
    },
  }
}
