// battle/src/v2/phases/index.ts
// Seer2 Phase handler registration.

import type { PhaseManager, EffectPipeline } from '@arcadia-eternity/engine'
import type { PetSystem } from '../systems/pet.system.js'
import type { PlayerSystem } from '../systems/player.system.js'
import type { MarkSystem } from '../systems/mark.system.js'
import type { SkillSystem } from '../systems/skill.system.js'
import type { StatStageMarkSystem } from '../systems/stat-stage-mark.system.js'

import { BattleStartHandler } from './battle-start.handler.js'
import { TurnHandler } from './turn.handler.js'
import { SelectionHandler } from './selection.handler.js'
import { SkillHandler } from './skill.handler.js'
import { SwitchHandler } from './switch.handler.js'
import { DamageHandler } from './damage.handler.js'
import { HealHandler } from './heal.handler.js'
import { RageHandler } from './rage.handler.js'
import { AddMarkHandler } from './add-mark.handler.js'
import { RemoveMarkHandler } from './remove-mark.handler.js'
import { MarkUpdateHandler } from './mark-update.handler.js'
import { MarkCleanupHandler } from './mark-cleanup.handler.js'
import { StatStageHandler } from './stat-stage.handler.js'
import { BattleSwitchHandler } from './battle-switch.handler.js'

export interface Seer2Systems {
  petSystem: PetSystem
  playerSystem: PlayerSystem
  markSystem: MarkSystem
  skillSystem: SkillSystem
  statStageSystem: StatStageMarkSystem
  effectPipeline: EffectPipeline
}

/**
 * Register all Seer2 phase handlers with the engine's PhaseManager.
 */
export function registerSeer2Phases(pm: PhaseManager, systems: Seer2Systems): void {
  const { petSystem, playerSystem, markSystem, skillSystem, statStageSystem, effectPipeline } = systems

  pm.register(new BattleStartHandler(effectPipeline, playerSystem, petSystem))
  pm.register(new TurnHandler(playerSystem, petSystem, skillSystem, markSystem, pm, effectPipeline))
  pm.register(new SelectionHandler())
  pm.register(new SkillHandler(playerSystem, petSystem, skillSystem, statStageSystem, pm, effectPipeline))
  pm.register(new SwitchHandler(playerSystem, petSystem, markSystem, pm, effectPipeline))
  pm.register(new DamageHandler(petSystem, markSystem, effectPipeline))
  pm.register(new HealHandler(petSystem, effectPipeline))
  pm.register(new RageHandler(playerSystem, effectPipeline))
  pm.register(new AddMarkHandler(markSystem, pm, effectPipeline))
  pm.register(new RemoveMarkHandler(markSystem, effectPipeline))
  pm.register(new MarkUpdateHandler(markSystem, effectPipeline))
  pm.register(new MarkCleanupHandler(markSystem))
  pm.register(new StatStageHandler(statStageSystem))
  pm.register(new BattleSwitchHandler(playerSystem, petSystem, pm))
}

export {
  BattleStartHandler,
  TurnHandler,
  SelectionHandler,
  SkillHandler,
  SwitchHandler,
  DamageHandler,
  HealHandler,
  RageHandler,
  AddMarkHandler,
  RemoveMarkHandler,
  MarkUpdateHandler,
  MarkCleanupHandler,
  StatStageHandler,
  BattleSwitchHandler,
}
