import type { PlayerSelection } from '@arcadia-eternity/const'
import type { World } from '@arcadia-eternity/engine'
import type { SelectionSystem } from '../systems/selection.system.js'

export type DecisionPhase = 'teamSelection' | 'switch' | 'selection'
export type DecisionCapability = 'public' | 'privileged'
export type AiStrategy = 'simple' | 'random'

export interface DecisionContext {
  world: World
  playerId: string
  phase: DecisionPhase
  selectionSystem: SelectionSystem
  abortSignal?: AbortSignal
}

export interface DecisionProvider {
  readonly capabilities: readonly DecisionCapability[]
  decide(ctx: DecisionContext): Promise<PlayerSelection>
}

export type DecisionProviderFactory = (options?: Record<string, unknown>) => DecisionProvider

export type DecisionProviderSpec =
  | { type: 'human' }
  | { type: 'rule'; strategy?: AiStrategy }
  | { type: 'custom'; key: string; options?: Record<string, unknown> }
