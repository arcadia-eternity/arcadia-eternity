// battle/src/v2/index.ts
// Battle V2 — ECS-based battle system entry point.
// Re-exports all schemas, systems, phases, and the game factory.

export * from './schemas/index.js'
export * from './systems/index.js'
export { registerSeer2Phases } from './phases/index.js'
export { createBattle, type BattleConfig, type BattleInstance } from './game.js'
export { BattleOrchestrator } from './orchestrator.js'
export { LocalBattleSystemV2 } from './local-battle.js'
export { DecisionManager } from './decision/manager.js'
export type { DecisionProviderSpec, DecisionProviderFactory, AiStrategy } from './decision/types.js'
export * from './data/index.js'
