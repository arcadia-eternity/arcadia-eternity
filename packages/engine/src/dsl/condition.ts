// engine/src/dsl/condition.ts
// Backward-compatible condition entrypoint.

export type {
  CommonCondition,
  CommonConditionHooks,
} from './types.js'

export {
  evaluateCommonCondition,
} from './evaluators.js'
