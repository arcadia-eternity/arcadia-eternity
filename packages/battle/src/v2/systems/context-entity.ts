// battle/src/v2/systems/context-entity.ts
// Context entity creation, recursive parent-chain lookup, and destruction.

import { createEntity, setComponent, getComponent, removeEntity } from '@arcadia-eternity/engine'
import type { World } from '@arcadia-eternity/engine'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tag used to identify context entities via queryByTag */
export const CONTEXT_TAG = '_battle_context'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Common context data shape stored in the 'context' component */
export interface ContextData {
  type: string
  parentId?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Context entity lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new context entity in the world.
 *
 * Creates an entity tagged with CONTEXT_TAG and stores context data
 * as a 'context' component. The `data` parameter already includes
 * `type` and optionally `parentId`.
 *
 * @returns The created entity's ID
 */
export function createContextEntity(
  world: World,
  _systems: Record<string, unknown>,
  data: ContextData & Record<string, unknown>,
  parentId?: string,
): string {
  const entity = createEntity(world, undefined, [CONTEXT_TAG])
  setComponent(world, entity.id, 'context', { ...data, parentId: parentId ?? data.parentId })
  return entity.id
}

/**
 * Recursively find a context entity of a given type by traversing
 * the parent chain upward.
 *
 * Starts from `startEntityId`, checks its context type, then follows
 * `parentId` links up the chain until a match is found or the root
 * is reached.
 *
 * @returns The context component data, or `undefined` if not found
 */
export function findContextByType(
  world: World,
  systems: Record<string, unknown>,
  startEntityId: string,
  contextType: string,
): Record<string, unknown> | undefined {
  let currentId: string | undefined = startEntityId

  while (currentId) {
    const component = getComponent(world, currentId, 'context') as ContextData | undefined
    if (component && component.type === contextType) {
      return component
    }
    currentId = component?.parentId
  }

  return undefined
}

/**
 * Destroy a context entity from the world.
 *
 * Removes the entity and all its components from the world.
 * Does NOT cascade to child entities (manual cleanup required).
 */
export function destroyContextEntity(world: World, systems: Record<string, unknown>, entityId: string): void {
  removeEntity(world, entityId)
}

// ---------------------------------------------------------------------------
// Current context entity ID accessors
// ---------------------------------------------------------------------------

/**
 * Get the current context entity ID from the world.
 */
export function getCurrentContextEntityId(world: World): string | undefined {
  return world.currentContextEntityId
}

/**
 * Set the current context entity ID on the world.
 */
export function setCurrentContextEntityId(world: World, entityId: string | undefined): void {
  world.currentContextEntityId = entityId
}
