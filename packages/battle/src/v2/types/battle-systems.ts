// battle/src/v2/types/battle-systems.ts
// System references for world.systems

import type {
  AttributeSystem,
  EffectPipeline,
  EventBus,
  GameRng,
  PhaseManager,
  WorldPlugins,
  WorldSystems,
} from '@arcadia-eternity/engine'
import type { MarkSystem, PetSystem, PlayerSystem, SkillSystem, StatStageMarkSystem } from '../systems'
import type { TransformStrategy } from '@arcadia-eternity/plugin-transformation'
import type { BattleConfig } from '../game'
import type { BattleAttributes } from './battle-attributes.js'
import type { BattleState } from './battle-state.js'
import type { PhaseRegistry } from './phase-registry.js'

// ... rest of imports

export interface BattleSystems extends WorldSystems {
  petSystem: PetSystem
  skillSystem: SkillSystem
  markSystem: MarkSystem
  playerSystem: PlayerSystem
  attrSystem: AttributeSystem<BattleState, BattleSystems, WorldPlugins, BattleAttributes>
  statStageSystem: StatStageMarkSystem
  phaseManager: PhaseManager<BattleState, BattleSystems, WorldPlugins, PhaseRegistry>
  eventBus: EventBus
  effectPipeline: EffectPipeline
  rng: GameRng
  transformStrategy?: TransformStrategy
  config: BattleConfig
}
