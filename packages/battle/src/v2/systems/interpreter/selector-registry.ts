import type { World } from '@arcadia-eternity/engine'
import type { SelectorChain } from '@arcadia-eternity/schema'
import type { InterpreterContext } from './context.js'

export type SelectorBaseHandler = (
  ctx: InterpreterContext,
  base: string,
) => unknown[]

export type SelectorChainHandler = (
  ctx: InterpreterContext,
  current: unknown[],
  step: SelectorChain,
) => unknown[]

const SELECTOR_BASE_REGISTRY_KEY = '__effectSelectorBaseRegistry'
const SELECTOR_CHAIN_REGISTRY_KEY = '__effectSelectorChainRegistry'

function ensureBaseRegistry(world: World): Map<string, SelectorBaseHandler> {
  const meta = world.meta as Record<string, unknown>
  const existing = meta[SELECTOR_BASE_REGISTRY_KEY]
  if (existing instanceof Map) return existing as Map<string, SelectorBaseHandler>
  const created = new Map<string, SelectorBaseHandler>()
  meta[SELECTOR_BASE_REGISTRY_KEY] = created
  return created
}

function ensureChainRegistry(world: World): Map<string, SelectorChainHandler> {
  const meta = world.meta as Record<string, unknown>
  const existing = meta[SELECTOR_CHAIN_REGISTRY_KEY]
  if (existing instanceof Map) return existing as Map<string, SelectorChainHandler>
  const created = new Map<string, SelectorChainHandler>()
  meta[SELECTOR_CHAIN_REGISTRY_KEY] = created
  return created
}

export function registerSelectorBaseHandler(
  world: World,
  base: string,
  handler: SelectorBaseHandler,
): void {
  if (!base) return
  ensureBaseRegistry(world).set(base, handler)
}

export function registerSelectorBaseHandlers(
  world: World,
  handlers: Record<string, SelectorBaseHandler>,
): void {
  for (const [base, handler] of Object.entries(handlers)) {
    registerSelectorBaseHandler(world, base, handler)
  }
}

export function registerSelectorChainHandler(
  world: World,
  stepType: string,
  handler: SelectorChainHandler,
): void {
  if (!stepType) return
  ensureChainRegistry(world).set(stepType, handler)
}

export function registerSelectorChainHandlers(
  world: World,
  handlers: Record<string, SelectorChainHandler>,
): void {
  for (const [type, handler] of Object.entries(handlers)) {
    registerSelectorChainHandler(world, type, handler)
  }
}

export function getSelectorBaseHandler(
  world: World,
  base: string,
): SelectorBaseHandler | undefined {
  if (!base) return undefined
  return ensureBaseRegistry(world).get(base)
}

export function getSelectorChainHandler(
  world: World,
  stepType: string,
): SelectorChainHandler | undefined {
  if (!stepType) return undefined
  return ensureChainRegistry(world).get(stepType)
}

export function clearSelectorHandlers(world: World): void {
  ensureBaseRegistry(world).clear()
  ensureChainRegistry(world).clear()
}
