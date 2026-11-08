/** The same domain API used by official TS effects, plus optional authoring helpers. */
export * from './src/engine/index'
export * from './src/engine/transformation'
export * from './src/engine/transformationStrategies'
export * from './src/engine/rng'
export * from '@arcadia-eternity/const'
export * from './src/engine/reactiveValue'
export * as valuePlans from './src/engine/values'
export { parameterAddress, defineParameter, ParameterCatalog } from './src/engine/content/parameters'
export * from './src/engine/content/authoring'
export { hasAuthoredParameters } from './src/engine/content/authoring/runtime'
export {
  defineCodeEffect,
  codeEffectDefinition,
  effectSdkApiVersion,
  type CodeEffectContext,
  type NativeCodeEffectDefinition,
} from './src/engine/content/code-effects'
export type { NativeBehaviorExport } from './src/engine/content/behaviors'
export type { EffectSdk, CodeEffectModuleContext, CodeEffectModule } from './src/engine/content/effect-sdk'
export {
  defineNativeEffect,
  nativeEffectTriggers,
  type NativeEffectTrigger,
  type NativeEffectContext,
  type NativeEffectDefinition,
} from './src/engine/content/native-effect'
export { ExecutionBudgetExceeded, executionBudgetPolicy } from './src/engine/execution/budget'

export {
  defineEffectState,
  getEffectState,
  setEffectState,
  type EffectStateDefinition,
  type EffectStateEntity,
} from './src/engine/content/effect-state'
