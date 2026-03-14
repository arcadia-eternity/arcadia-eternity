// battle/src/v2/types/battle-systems.ts
// System references for world.systems

import type { GameRng } from '@arcadia-eternity/engine'
import type { PetSystem } from '../systems/pet.system.js'
import type { SkillSystem } from '../systems/skill.system.js'
import type { MarkSystem } from '../systems/mark.system.js'
import type { PlayerSystem } from '../systems/player.system.js'
import type { PhaseManager, EventBus, AttributeSystem, EffectPipeline } from '@arcadia-eternity/engine'
import type { TransformStrategy } from '@arcadia-eternity/plugin-transformation'
import type { BattleConfig } from '../game.js'
import type { StatStageMarkSystem } from '../systems/stat-stage-mark.system.js'

/**
 * All systems and runtime references for a battle.
 * Stored in world.systems (non-serializable).
 */
export interface BattleSystems {
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
