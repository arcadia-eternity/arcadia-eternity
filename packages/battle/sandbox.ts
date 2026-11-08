/// <reference lib="dom" preserve="true" />
export { ArenaEffectModule } from './src/sandbox/effect-module'
export {
  SandboxFault,
  browserSandboxStartup,
  sandboxPolicy,
  type SandboxPolicy,
  type EffectModuleArtifact,
  type EffectExecutor,
  type PreparedEffectModule,
} from './src/sandbox/contracts'
export {
  BattleWorkerManager,
  BattleWorkerAdmissionError,
  type BattleWorkerAdmissionReason,
  WorkerBattleSystem,
  type BattleWorker,
  type BattleWorkerPolicy,
  type BattleWorkerStatus,
  type BattleWorkerPoolStatus,
} from './src/sandbox/worker-manager'
export type { SandboxEnvironment, SandboxBattleInput } from './src/sandbox/runtime'
