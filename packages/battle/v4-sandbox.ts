/// <reference lib="dom" preserve="true" />
export { ArenaEffectModule } from './src/v4-sandbox/effect-module'
export {
  SandboxFault,
  sandboxPolicy,
  type SandboxPolicy,
  type EffectModuleArtifact,
  type EffectExecutor,
  type PreparedEffectModule,
} from './src/v4-sandbox/contracts'
export {
  BattleWorkerManager,
  WorkerBattleSystem,
  type BattleWorker,
  type BattleWorkerPolicy,
  type BattleWorkerStatus,
} from './src/v4-sandbox/worker-manager'
export type { SandboxEnvironment, SandboxBattleInput } from './src/v4-sandbox/runtime'
