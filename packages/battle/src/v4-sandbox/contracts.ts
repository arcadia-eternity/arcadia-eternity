import type { CodeEffectModule } from '../v4/content/effect-sdk'

/** Compiled ESM with a closed dependency graph. Its text is evaluated only by Arena. */
export interface EffectModuleArtifact {
  readonly format: 'arcadia.effect-module'
  readonly version: 1
  readonly sdkApi: 2
  readonly packageId: string
  readonly source: string
}
export const sandboxPolicy = Object.freeze({
  memoryBytes: 128 * 1024 * 1024,
  wasmBytes: 256 * 1024 * 1024,
  stackBytes: 512 * 1024,
  prepareMs: 10_000,
  callMs: 500,
  callsPerRoot: 50_000,
  callsPerSession: 5_000_000,
  retainedObjects: 50_000,
  sourceBytes: 4 * 1024 * 1024,
  packagesPerBattle: 32,
  outputBytes: 4 * 1024 * 1024,
})
export type SandboxPolicy = { readonly [K in keyof typeof sandboxPolicy]: number }
export type SandboxFaultCode = 'artifact' | 'execution' | 'permission' | 'budget' | 'disposed' | 'worker'
export class SandboxFault extends Error {
  readonly name = 'SandboxFault'
  constructor(
    readonly code: SandboxFaultCode,
    readonly packageId: string,
    message: string,
  ) {
    super(`${packageId}: ${message.slice(0, 1000)}`)
  }
}
export interface PreparedEffectModule extends CodeEffectModule {
  readonly packageId: string
  readonly state: 'ready' | 'faulted' | 'disposed'
  /** Lease the prepared logic to one battle; call before constructing its entities. */
  beginSession(): void
  /** Release battle bridge references after native subscriptions and entities clean up. */
  endSession(): void
  assertHealthy(): void
  dispose(): void
}
export interface EffectExecutor {
  prepare(artifact: EffectModuleArtifact): Promise<PreparedEffectModule>
}
