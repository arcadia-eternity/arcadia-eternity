// battle/src/v2/systems/interpreter/context.ts
// Interpreter context types for effect DSL execution.

import type { World, PhaseManager, EventBus, EffectFireContext, AttributeSystem, GameRng } from '@arcadia-eternity/engine'
import type { EffectPipeline } from '@arcadia-eternity/engine'
import type { TransformStrategy } from '@arcadia-eternity/plugin-transformation'
import type { PetSystem } from '../pet.system.js'
import type { SkillSystem } from '../skill.system.js'
import type { MarkSystem } from '../mark.system.js'
import type { PlayerSystem } from '../player.system.js'
import type { StatStageMarkSystem } from '../stat-stage-mark.system.js'
import type {
  UseSkillContextData,
  DamageContextData,
  HealContextData,
  RageContextData,
  AddMarkContextData,
  RemoveMarkContextData,
  SwitchPetContextData,
  StackContextData,
  ConsumeStackContextData,
  TransformContextData,
  TurnContextData,
} from '../../schemas/context.schema.js'

/**
 * Battle systems needed by the effect interpreter.
 */
export interface BattleSystems {
  petSystem: PetSystem
  skillSystem: SkillSystem
  markSystem: MarkSystem
  playerSystem: PlayerSystem
  phaseManager: PhaseManager
  eventBus: EventBus
  effectPipeline: EffectPipeline
  statStageSystem: StatStageMarkSystem
  attrSystem: AttributeSystem
  rng: GameRng
  transformStrategy?: TransformStrategy
}

export type BattlePhaseContext =
  | UseSkillContextData
  | DamageContextData
  | HealContextData
  | RageContextData
  | AddMarkContextData
  | RemoveMarkContextData
  | SwitchPetContextData
  | StackContextData
  | ConsumeStackContextData
  | TransformContextData
  | TurnContextData

export interface InterpreterFireContext extends EffectFireContext {
  context?: BattlePhaseContext
  useSkillContext?: UseSkillContextData
  damageContext?: DamageContextData
  healContext?: HealContextData
  rageContext?: RageContextData
  addMarkContext?: AddMarkContextData
  removeMarkContext?: RemoveMarkContextData
  switchPetContext?: SwitchPetContextData
  stackContext?: StackContextData
  consumeStackContext?: ConsumeStackContextData
  turnContext?: TurnContextData
  transformContext?: TransformContextData
}

/**
 * Context passed to selector/condition/operator evaluation.
 */
export interface InterpreterContext {
  world: World
  fireCtx: InterpreterFireContext
  systems: BattleSystems
}
