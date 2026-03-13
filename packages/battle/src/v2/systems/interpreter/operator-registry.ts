import type { World } from '@arcadia-eternity/engine'
import type { OperatorDSL } from '@arcadia-eternity/schema'
import type { InterpreterContext } from './context.js'

export type OperatorHandler = (
  ctx: InterpreterContext,
  operator: OperatorDSL,
) => Promise<void> | void

const OPERATOR_REGISTRY_KEY = '__effectOperatorRegistry'

function ensureOperatorRegistry(world: World): Map<string, OperatorHandler> {
  const meta = world.meta as Record<string, unknown>
  const existing = meta[OPERATOR_REGISTRY_KEY]
  if (existing instanceof Map) return existing as Map<string, OperatorHandler>
  const created = new Map<string, OperatorHandler>()
  meta[OPERATOR_REGISTRY_KEY] = created
  return created
}

export function registerOperatorHandler(
  world: World,
  type: string,
  handler: OperatorHandler,
): void {
  if (!type) return
  ensureOperatorRegistry(world).set(type, handler)
}

export function registerOperatorHandlers(
  world: World,
  handlers: Record<string, OperatorHandler>,
): void {
  for (const [type, handler] of Object.entries(handlers)) {
    registerOperatorHandler(world, type, handler)
  }
}

export function getOperatorHandler(
  world: World,
  type: string,
): OperatorHandler | undefined {
  if (!type) return undefined
  return ensureOperatorRegistry(world).get(type)
}

export function clearOperatorHandlers(world: World): void {
  ensureOperatorRegistry(world).clear()
}
