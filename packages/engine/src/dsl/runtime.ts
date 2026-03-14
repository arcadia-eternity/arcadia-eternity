// engine/src/dsl/runtime.ts
// Backward-compatible runtime entrypoint.

export type {
  CompareOperator,
  RuntimeEvaluator,
  EvaluatorRuntimeHooks,
  CommonSelectorChainStep,
  SelectorChainRuntimeHooks,
} from './types.js'

export {
  evaluateRuntimeEvaluator,
} from './evaluators.js'

export {
  applyCommonSelectorChain,
} from './resolvers.js'
