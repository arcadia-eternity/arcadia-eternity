import type { BattleRuntimeSnapshot } from '@arcadia-eternity/interface'
import type { NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'
import type { NativePlayerSchemaType } from '@arcadia-eternity/battle/v4'
import type { PlayerSelection } from '@arcadia-eternity/const'

export interface RunSpec {
  teams: [NativePlayerSchemaType, NativePlayerSchemaType]
  seed: string
  maxTurns: number
  maxActions: number
  teamSelection: boolean
}
export interface RecordedInput {
  turn: number
  phase: string
  seat: number
  type: PlayerSelection['type']
  pet?: number
  skill?: { pet: number; slot: number }
  target?: string
  selectedPets?: number[]
  starterPet?: number
}
export interface RunResult {
  seed: string
  aiSeeds: string[]
  strategy: 'legal-skills-v1'
  status: 'completed' | 'truncated' | 'failed' | 'cancelled'
  turns: number
  actions: number
  winner: number | null
  reason: string
  error?: { code: string; message: string }
  players: {
    seat: number
    rage: number
    active: number
    team: { slot: number; species: string; hp: number; maxHp: number }[]
  }[]
}
export interface Replay {
  format: 'arcadia.cli.replay'
  version: 1
  environment: {
    build: NativePackLoadResult['build']
    revision: string
    packs: NativePackLoadResult['packs']
    data: NativePackLoadResult['data']
    works?: NativePackLoadResult['works']
  }
  spec: RunSpec
  initial: BattleRuntimeSnapshot
  inputs: RecordedInput[]
  expected: RunResult
}
