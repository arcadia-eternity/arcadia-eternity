// battle/src/v2/types/battle-systems.ts
// System references for world.systems

import type {
  AttributeSystem,
  EffectPipeline,
  EventBus,
  GameRng,
  PhaseManager,
  WorldSystems,
} from '@arcadia-eternity/engine'
import type { MarkSystem, PetSystem, PlayerSystem, SkillSystem, StatStageMarkSystem } from '../systems'
import type { TransformStrategy } from '@arcadia-eternity/plugin-transformation'
import type { BattleConfig } from '../game'

// ... rest of imports

/**
 * All systems and runtime references for a battle.
 * Stored in world.systems (non-serializable).
 */
export interface BattleSystems extends WorldSystems {
  // Core systems
  petSystem: PetSystem
  skillSystem: SkillSystem
  markSystem: MarkSystem
  playerSystem: PlayerSystem
  attrSystem: AttributeSystem
  statStageSystem: StatStageMarkSystem

  // Engine systems
  phaseManager: PhaseManager
  eventBus: EventBus
  effectPipeline: EffectPipeline

  // Runtime utilities
  rng: GameRng
  transformStrategy?: TransformStrategy

  // Config (immutable)
  config: BattleConfig
}
