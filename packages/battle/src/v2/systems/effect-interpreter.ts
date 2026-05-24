// battle/src/v2/systems/effect-interpreter.ts
// Seer2 EffectInterpreter — bridge between engine's EffectPipeline and
// the interpreter modules (conditions, selectors, operators).

import type { World, EffectInterpreter, WorldPlugins } from '@arcadia-eternity/engine'
import type { BattleWorld } from '../types/battle-world.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleSystems } from '../types/battle-systems.js'
import type { InterpreterContext, InterpreterFireContext } from './interpreter/context.js'
import { evaluateCondition } from './interpreter/conditions.js'
import { executeOperator } from './interpreter/operators.js'
import { parseConditionDsl, parseOperatorDslList } from './interpreter/dsl-validation.js'

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

type BattleWorldType = World<BattleState, BattleSystems, WorldPlugins>

function buildCtx(world: BattleWorldType, context: unknown): InterpreterContext {
  const bw = world as BattleWorld
  const systems = bw.systems
  if (!systems) {
    throw new Error('[effect-interpreter] world.systems is missing')
  }
  return {
    world,
    fireCtx: parseFireContext(context),
    systems,
  }
}

export const seer2EffectInterpreter: EffectInterpreter<BattleState, BattleSystems, WorldPlugins> = {
  evaluateCondition(world: BattleWorldType, condition: unknown, context: unknown): boolean {
    const ctx = buildCtx(world, context)
    const parsed = parseConditionDsl(condition)
    return evaluateCondition(ctx, parsed)
  },

  async executeOperator(world: BattleWorldType, operator: unknown, context: unknown): Promise<void> {
    const ctx = buildCtx(world, context)
    const parsedOperators = parseOperatorDslList(operator)
    for (const parsed of parsedOperators) {
      await executeOperator(ctx, parsed)
    }
  },
}
