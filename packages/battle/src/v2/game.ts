// battle/src/v2/game.ts
// Game entry point — assembles engine + plugins + systems into a Seer2 battle.

import {
  type World,
  createWorld,
  PhaseManager,
  EffectPipeline,
  EventBus,
  SchemaTypeChecker,
  AttributeSystem,
  GameRng,
} from '@arcadia-eternity/engine'
import { DamageSystem } from '@arcadia-eternity/plugin-damage'
import type { TimerConfig, TeamSelectionConfig } from '@arcadia-eternity/const'
import type { DecisionProviderFactory, DecisionProviderSpec } from './decision/types.js'

import { PetSystem } from './systems/pet.system.js'
import { SkillSystem } from './systems/skill.system.js'
import { MarkSystem } from './systems/mark.system.js'
import { PlayerSystem } from './systems/player.system.js'
import { StatStageMarkSystem } from './systems/stat-stage-mark.system.js'
import { createSeer2DamageFormula } from './systems/damage-formula.js'
import { createSeer2ExpressionResolver } from './systems/expression-resolver.js'
import { seer2EffectInterpreter } from './systems/effect-interpreter.js'
import { V2TransformStrategy } from './systems/transform-strategy.js'
import { ensureAttributeWriteAllowed } from './systems/interpreter/extractor-runtime.js'
import { registerSeer2Phases } from './phases/index.js'
import { createBattleState } from './types/battle-state.js'
import type { BattleSystems } from './types/battle-systems.js'

import { SpeciesSchema } from './schemas/species.schema.js'
import { PetSchema } from './schemas/pet.schema.js'
import { SkillSchema, BaseSkillSchema } from './schemas/skill.schema.js'
import { MarkSchema, BaseMarkSchema } from './schemas/mark.schema.js'
import { PlayerSchema } from './schemas/player.schema.js'
import {
  UseSkillContextSchema,
  DamageContextSchema,
  HealContextSchema,
  RageContextSchema,
  AddMarkContextSchema,
  RemoveMarkContextSchema,
  SwitchPetContextSchema,
  TransformContextSchema,
  TurnContextSchema,
} from './schemas/context.schema.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BattleConfig {
  // RNG
  seed?: string
  rngSeed?: number

  // Battle visibility/rules
  allowFaintSwitch?: boolean
  showHidden?: boolean
  strictExtractorTyping?: boolean

  // Runtime features
  timerConfig?: Partial<TimerConfig>
  teamSelection?: {
    enabled: boolean
    config?: Partial<TeamSelectionConfig>
  }

  ai?: {
    enabled?: boolean
    players?: Array<'playerA' | 'playerB'>
    strategy?: 'simple' | 'random'
  }

  decision?: {
    playerA?: DecisionProviderSpec
    playerB?: DecisionProviderSpec
    registry?: Record<string, DecisionProviderFactory>
  }

  // Rule-engine extension point
  customConfig?: Record<string, unknown>
}

export interface BattleInstance {
  world: World
  phaseManager: PhaseManager
  effectPipeline: EffectPipeline
  eventBus: EventBus
  schemaChecker: SchemaTypeChecker
  config: BattleConfig
  // Systems
  attrSystem: AttributeSystem
  petSystem: PetSystem
  skillSystem: SkillSystem
  markSystem: MarkSystem
  playerSystem: PlayerSystem
  damageSystem: DamageSystem
  statStageSystem: StatStageMarkSystem
}

// ---------------------------------------------------------------------------
// Schema registration
// ---------------------------------------------------------------------------

function registerSchemas(checker: SchemaTypeChecker): void {
  checker.register('Species', SpeciesSchema)
  checker.register('Pet', PetSchema)
  checker.register('BaseSkill', BaseSkillSchema)
  checker.register('Skill', SkillSchema)
  checker.register('BaseMark', BaseMarkSchema)
  checker.register('Mark', MarkSchema)
  checker.register('Player', PlayerSchema)
  checker.register('UseSkillContext', UseSkillContextSchema)
  checker.register('DamageContext', DamageContextSchema)
  checker.register('HealContext', HealContextSchema)
  checker.register('RageContext', RageContextSchema)
  checker.register('AddMarkContext', AddMarkContextSchema)
  checker.register('RemoveMarkContext', RemoveMarkContextSchema)
  checker.register('SwitchPetContext', SwitchPetContextSchema)
  checker.register('TransformContext', TransformContextSchema)
  checker.register('TurnContext', TurnContextSchema)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBattle(config: BattleConfig = {}): BattleInstance {
  const world = createWorld()

  // Build systems (dependency order: attrSystem first)
  const attrSystem = new AttributeSystem()
  const petSystem = new PetSystem(attrSystem)
  const skillSystem = new SkillSystem(attrSystem)
  const markSystem = new MarkSystem(attrSystem)
  const playerSystem = new PlayerSystem(attrSystem)
  const statStageSystem = new StatStageMarkSystem(attrSystem, markSystem)

  // Wire expression resolver into attribute system
  const resolver = createSeer2ExpressionResolver(attrSystem)
  attrSystem.setResolver(resolver)

  // Build damage system with Seer2 formula
  const damageSystem = new DamageSystem()
  damageSystem.setFormula(createSeer2DamageFormula(petSystem))

  // Build engine subsystems
  const phaseManager = new PhaseManager()
  const effectPipeline = new EffectPipeline(seer2EffectInterpreter, {
    beforeEffectExecute: (hookWorld, _effect, fireCtx) => {
      const effectEntityId = fireCtx.effectEntityId
      if (typeof effectEntityId !== 'string') return true
      const mark = markSystem.get(hookWorld, effectEntityId)
      if (!mark) return true
      return markSystem.isActive(hookWorld, effectEntityId)
    },
    afterEffectExecute: (hookWorld, effect, fireCtx) => {
      if (!effect.consumesStacks || effect.consumesStacks <= 0) return
      const effectEntityId = fireCtx.effectEntityId
      if (typeof effectEntityId !== 'string') return
      const mark = markSystem.get(hookWorld, effectEntityId)
      if (!mark) return
      markSystem.consumeStack(hookWorld, effectEntityId, effect.consumesStacks)
    },
  })
  const eventBus = new EventBus()
  const schemaChecker = new SchemaTypeChecker()

  registerSchemas(schemaChecker)

  // Register all phase handlers with their system dependencies
  registerSeer2Phases(phaseManager, { petSystem, playerSystem, markSystem, skillSystem, statStageSystem, effectPipeline })

  // Initialize RNG
  const rngSeed = config.seed ?? config.rngSeed
  const rng = new GameRng(rngSeed)

  // Store systems in world.systems (non-serializable runtime references)
  const systems: BattleSystems = {
    petSystem,
    skillSystem,
    markSystem,
    playerSystem,
    attrSystem,
    statStageSystem,
    phaseManager,
    eventBus,
    effectPipeline,
    rng,
    config,
    transformStrategy: new V2TransformStrategy(),
  }
  world.systems = systems as unknown as Record<string, unknown>
  world.meta.strictExtractorTyping = config.strictExtractorTyping === true
  attrSystem.setWriteGuard(({ world, entityId, key }) => ensureAttributeWriteAllowed(world, systems, entityId, key))
  attrSystem.setBaseValueSetHook(({ world, entityId, key, value }) => {
    if (key !== 'currentHp') return
    if (!petSystem.get(world, entityId)) return
    if (attrSystem.getBaseValue(world, entityId, 'isAlive') === undefined) return
    const hp = typeof value === 'number' ? value : 0
    attrSystem.setBaseValue(world, entityId, 'isAlive', hp > 0)
  })

  return {
    world,
    phaseManager,
    effectPipeline,
    eventBus,
    schemaChecker,
    config,
    attrSystem,
    petSystem,
    skillSystem,
    markSystem,
    playerSystem,
    damageSystem,
    statStageSystem,
  }
}
