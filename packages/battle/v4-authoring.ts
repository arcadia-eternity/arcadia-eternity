/** Trusted effect authoring API; content documents reference compiled definitions by stable ID. */
export * from './src/v4/content/authoring'
export { hasAuthoredParameters } from './src/v4/content/authoring/runtime'
export {
  defineCodeEffect,
  codeEffectDefinition,
  effectSdkApiVersion,
  type CodeEffectContext,
} from './src/v4/content/code-effects'
export type { NativeBehaviorExport } from './src/v4/content/behaviors'
export type { BaseMark, MarkInstance } from './src/v4/mark'
