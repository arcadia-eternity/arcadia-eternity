/** The same domain API used by official TS effects, plus optional authoring helpers. */
export * from './src/v4/index'
export * from './src/v4/transformation'
export * from './src/v4/transformationStrategies'
export * from './src/v4/rng'
export * from '@arcadia-eternity/const'
export * from './src/v4/reactiveValue'
export * as valuePlans from './src/v4/values'
export { parameterAddress, defineParameter, ParameterCatalog } from './src/v4/content/parameters'
export * from './src/v4/content/authoring'
export { hasAuthoredParameters } from './src/v4/content/authoring/runtime'
export {
  defineCodeEffect,
  codeEffectDefinition,
  effectSdkApiVersion,
  type CodeEffectContext,
  type NativeCodeEffectDefinition,
} from './src/v4/content/code-effects'
export type { NativeBehaviorExport } from './src/v4/content/behaviors'
export type { EffectSdk, CodeEffectModuleContext, CodeEffectModule } from './src/v4/content/effect-sdk'
export {
  defineNativeEffect,
  nativeEffectTriggers,
  type NativeEffectTrigger,
  type NativeEffectContext,
  type NativeEffectDefinition,
} from './src/v4/content/native-effect'
export { ExecutionBudgetExceeded, executionBudgetPolicy } from './src/v4/execution/budget'
