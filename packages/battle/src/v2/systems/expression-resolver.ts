// battle/src/v2/systems/expression-resolver.ts
// Seer2 ExpressionResolver — resolves DSL expressions inside modifiers.

import {
  type World,
  type ExpressionResolver,
  type AttributeSystem,
  evaluateNumericExpression,
  toNumber,
} from '@arcadia-eternity/engine'
import type { Value } from '@arcadia-eternity/schema'
import type { InterpreterContext, InterpreterFireContext } from './interpreter/context.js'
import { resolveSelector } from './interpreter/selector.js'
import { resolveValue } from './interpreter/value.js'
import { isSelectorDsl } from './interpreter/type-guards.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createSeer2ExpressionResolver(attrSystem: AttributeSystem): ExpressionResolver {
  const resolver: ExpressionResolver = {
    evaluate(world: World, expr: unknown, computeStack: Set<string>): number {
      return evaluateNumericExpression(expr, {
        resolveRef: (entityId, attribute) => {
          return toNumber(attrSystem.getValue(world, entityId, attribute, undefined, computeStack))
        },
        resolveSelector: (selectorExpr) => {
          if (!isSelectorDsl(selectorExpr)) return 0

          const currentKey = [...computeStack].at(-1)
          const currentEntityId = typeof currentKey === 'string' ? currentKey.split('.')[0] : undefined

          const node = isRecord(expr) ? expr : {}
          const rawFireCtx = isRecord(node.fireCtx) ? node.fireCtx : {}
          const sourceEntityId = typeof rawFireCtx.sourceEntityId === 'string'
            ? rawFireCtx.sourceEntityId
            : (typeof rawFireCtx.targetEntityId === 'string' ? rawFireCtx.targetEntityId : currentEntityId)
          if (!sourceEntityId) return 0

          const fireCtx: InterpreterFireContext = {
            trigger: typeof rawFireCtx.trigger === 'string' ? rawFireCtx.trigger : 'attribute:dynamic',
            sourceEntityId,
            contextId: typeof rawFireCtx.contextId === 'string' ? rawFireCtx.contextId : undefined,
            phaseId: typeof rawFireCtx.phaseId === 'string' ? rawFireCtx.phaseId : undefined,
            effectId: typeof rawFireCtx.effectId === 'string' ? rawFireCtx.effectId : undefined,
            effectEntityId: typeof rawFireCtx.effectEntityId === 'string' ? rawFireCtx.effectEntityId : undefined,
          }

          const systems = world.systems as unknown as InterpreterContext['systems']
          if (!systems) return 0

          const selectorCtx: InterpreterContext = { world, fireCtx, systems }
          return toNumber(resolveSelector(selectorCtx, selectorExpr))
        },
        resolveValue: (valueExpr) => {
          const currentKey = [...computeStack].at(-1)
          const currentEntityId = typeof currentKey === 'string' ? currentKey.split('.')[0] : undefined
          if (!currentEntityId) return 0

          const node = isRecord(expr) ? expr : {}
          const rawFireCtx = isRecord(node.fireCtx) ? node.fireCtx : {}
          const systems = world.systems as unknown as InterpreterContext['systems']
          if (!systems) return 0

          const valueCtx: InterpreterContext = {
            world,
            fireCtx: {
              trigger: 'attribute:dynamic',
              sourceEntityId: currentEntityId,
              effectId: typeof rawFireCtx.effectId === 'string' ? rawFireCtx.effectId : undefined,
              effectEntityId: typeof rawFireCtx.effectEntityId === 'string' ? rawFireCtx.effectEntityId : undefined,
            },
            systems,
          }
          return toNumber(resolveValue(valueCtx, valueExpr as Value | null | undefined))
        },
      })
    },
  }
  return resolver
}
