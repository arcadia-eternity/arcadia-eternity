// battle/src/v2/systems/effect-interpreter.ts
// Seer2 EffectInterpreter — bridge between engine's EffectPipeline and
// the interpreter modules (conditions, selectors, operators).

import type { World, EffectInterpreter } from '@arcadia-eternity/engine'
import type { InterpreterContext, InterpreterFireContext } from './interpreter/context.js'
import { evaluateCondition } from './interpreter/conditions.js'
import { executeOperator } from './interpreter/operators.js'
import {
  parseConditionDsl,
  parseOperatorDslList,
} from './interpreter/dsl-validation.js'

/**
 * Build an InterpreterContext from World + EffectFireContext.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFireContext(raw: unknown): InterpreterFireContext {
  if (!isRecord(raw)) {
    throw new Error('[effect-interpreter] Invalid fire context: not an object')
  }
  if (typeof raw.sourceEntityId !== 'string') {
    throw new Error('[effect-interpreter] Invalid fire context: sourceEntityId must be string')
  }
  if (typeof raw.trigger !== 'string') {
    throw new Error('[effect-interpreter] Invalid fire context: trigger must be string')
  }
  return raw as InterpreterFireContext
}

function buildCtx(world: World, context: unknown): InterpreterContext {
  const systems = world.systems as unknown as InterpreterContext['systems']
  if (!systems) {
    throw new Error('[effect-interpreter] world.systems is missing')
  }
  return {
    world,
    fireCtx: parseFireContext(context),
    systems,
  }
}

/**
 * Seer2 effect interpreter.
 *
 * Conditions and operators are opaque to the engine — this interpreter
 * knows how to evaluate Seer2-specific condition DSL and execute
 * Seer2-specific operator DSL.
 */
export const seer2EffectInterpreter: EffectInterpreter = {
  evaluateCondition(world: World, condition: unknown, context: unknown): boolean {
    const ctx = buildCtx(world, context)
    const parsed = parseConditionDsl(condition)
    return evaluateCondition(ctx, parsed)
  },

  async executeOperator(world: World, operator: unknown, context: unknown): Promise<void> {
    const ctx = buildCtx(world, context)
    const parsedOperators = parseOperatorDslList(operator)
    for (const parsed of parsedOperators) {
      await executeOperator(ctx, parsed)
    }
  },
}
