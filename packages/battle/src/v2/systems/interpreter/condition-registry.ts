import type { World } from '@arcadia-eternity/engine'
import type { ConditionDSL } from '@arcadia-eternity/schema'
import type { InterpreterContext } from './context.js'

export type ConditionHandler = (
  ctx: InterpreterContext,
  condition: ConditionDSL,
) => boolean

const CONDITION_REGISTRY_KEY = '__effectConditionRegistry'

function ensureConditionRegistry(world: World): Map<string, ConditionHandler> {
  const meta = world.meta as Record<string, unknown>
  const existing = meta[CONDITION_REGISTRY_KEY]
  if (existing instanceof Map) return existing as Map<string, ConditionHandler>
  const created = new Map<string, ConditionHandler>()
  meta[CONDITION_REGISTRY_KEY] = created
  return created
}

export function registerConditionHandler(
  world: World,
  type: string,
  handler: ConditionHandler,
): void {
  if (!type) return
  ensureConditionRegistry(world).set(type, handler)
}

export function registerConditionHandlers(
  world: World,
  handlers: Record<string, ConditionHandler>,
): void {
  for (const [type, handler] of Object.entries(handlers)) {
    registerConditionHandler(world, type, handler)
  }
}

export function getConditionHandler(
  world: World,
  type: string,
): ConditionHandler | undefined {
  if (!type) return undefined
  return ensureConditionRegistry(world).get(type)
}

export function clearConditionHandlers(world: World): void {
  ensureConditionRegistry(world).clear()
}
