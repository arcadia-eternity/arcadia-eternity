// engine/src/index.ts
// Public API of @arcadia-eternity/engine

// World (ECS container)
export {
  type Entity,
  type ComponentStore,
  type World,
  createWorld,
  createEntity,
  removeEntity,
  getEntity,
  hasEntity,
  entityCount,
  generateId,
  // Tag operations
  addTag,
  removeTag,
  hasTag,
  queryByTag,
  queryByTags,
  // Component operations
  setComponent,
  getComponent,
  getComponentOrThrow,
  hasComponent,
  removeComponent,
  queryByComponent,
  queryByComponents,
} from './world.js'

// Attribute system
export {
  ATTRIBUTE_STORE,
  type AttributeValue,
  type ModifierType,
  type DurationType,
  type PhaseTypeSpec,
  type ModifierValue,
  type ModifierDef,
  type AttributeStore,
  type ExpressionResolver,
  type PhaseContext,
  type AttributeWriteGuardContext,
  type AttributeWriteGuard,
  AttributeSystem,
} from './attribute.js'

// Phase scheduler
export {
  type PhaseState,
  type PhaseDef,
  type PhaseResult,
  type PhaseHandler,
  PhaseManager,
} from './phase.js'

// Effect pipeline
export {
  EFFECTS,
  type EffectDef,
  type EffectInterpreter,
  type EffectFireContext,
  EffectPipeline,
} from './effect.js'

// Event system
export {
  type GameEvent,
  type EventHandler,
  EventBus,
} from './events.js'

// Snapshot / Restore
export {
  createSnapshot,
  restoreWorld,
  cloneWorld,
} from './snapshot.js'

// Schema type checker
export {
  type PropertyInfo,
  SchemaTypeChecker,
} from './schema-checker.js'

// Config store
export {
  type ConfigValue,
  type ConfigModifierType,
  type ConfigDurationType,
  type ConfigPhaseTypeSpec,
  type ConfigModifierDef,
  type ConfigStore,
  createConfigStore,
  registerConfig,
  addConfigTags,
  getConfigKeysByTag,
  setConfigValue,
  getConfigValue,
  addConfigModifier,
  removeConfigModifier,
  removeConfigModifiersBySource,
  cleanupPhaseTypeConfigModifiers,
} from './config-store.js'

// Random number generator
export {
  type RngState,
  GameRng,
} from './rng.js'

// Generic numeric expression helpers
export {
  type NumericEvalHooks,
  toNumber,
  evaluateNumericExpression,
} from './dsl/numeric.js'

// Generic DSL runtime helpers
export {
  type CompareOperator,
  type RuntimeEvaluator,
  type EvaluatorRuntimeHooks,
  type CommonSelectorChainStep,
  type SelectorChainRuntimeHooks,
  evaluateRuntimeEvaluator,
  applyCommonSelectorChain,
} from './dsl/runtime.js'

// Generic DSL condition/value helpers
export {
  type CommonCondition,
  type CommonConditionHooks,
  evaluateCommonCondition,
} from './dsl/condition.js'
export {
  type RuntimeValueHooks,
  resolveRuntimeValue,
} from './dsl/value.js'
export {
  type RuntimeSelectorHooks,
  resolveRuntimeSelector,
} from './dsl/selector.js'
