// engine/src/world.ts
// ECS World container — the core data structure of the engine.
// All state is plain data, fully serializable.
//
// Entity = ID + optional tags (no data on entity itself)
// Component = plain data stored by componentType → entityId
// System = class that queries/operates on specific component combinations

import { nanoid } from 'nanoid'
import type { ConfigStore } from './config-store.js'
import type { PhaseDef } from './phase.js'
import type { GameEvent } from './events.js'
import { createConfigStore } from './config-store.js'

// ---------------------------------------------------------------------------
// Entity — just an ID with optional tags
// ---------------------------------------------------------------------------

export interface Entity {
  id: string
  tags: Set<string>
}

// ---------------------------------------------------------------------------
// Component storage
// ---------------------------------------------------------------------------

/**
 * ComponentStore: componentType → entityId → component data.
 * Each component type is a flat Record keyed by entity ID.
 * Component data is always plain serializable objects.
 */
export type ComponentStore = Record<string, Record<string, unknown>>

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/**
 * The World is the single source of truth.
 * Everything that matters for game state lives here as plain data.
 */
export interface World {
  /** All entities keyed by id */
  entities: Record<string, Entity>
  /** Index: tag → set of entity ids (runtime, derived from entity tags) */
  byTag: Record<string, Set<string>>
  /** Component storage: componentType → entityId → data */
  components: ComponentStore
  /** Config store for game configuration values */
  configStore: ConfigStore
  /** Phase execution stack (serializable) */
  phaseStack: PhaseDef[]
  /** Event log (append-only during a phase, flushed to listeners) */
  eventLog: GameEvent[]
  /** Game state (serializable, game-layer specific) */
  state: Record<string, unknown>
  /** System references (non-serializable, runtime only) */
  systems: Record<string, unknown>
  /** Plugin private data (serializable, plugin-specific) */
  plugins: Record<string, unknown>
  /** Arbitrary metadata (non-serializable, for debugging/profiling) */
  meta: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorld(): World {
  return {
    entities: {},
    byTag: {},
    components: {},
    configStore: createConfigStore(),
    phaseStack: [],
    eventLog: [],
    state: {},
    systems: {},
    plugins: {},
    meta: {},
  }
}

// ---------------------------------------------------------------------------
// Entity CRUD
// ---------------------------------------------------------------------------

export function createEntity(world: World, id?: string, tags?: string[]): Entity {
  const entityId = id ?? generateId()
  if (world.entities[entityId]) {
    throw new Error(`Entity with id '${entityId}' already exists`)
  }

  const entity: Entity = { id: entityId, tags: new Set(tags ?? []) }
  world.entities[entityId] = entity

  // Maintain tag index
  for (const tag of entity.tags) {
    if (!world.byTag[tag]) world.byTag[tag] = new Set()
    world.byTag[tag].add(entityId)
  }

  return entity
}

export function removeEntity(world: World, id: string): void {
  const entity = world.entities[id]
  if (!entity) return

  // Remove from tag index
  for (const tag of entity.tags) {
    world.byTag[tag]?.delete(id)
    if (world.byTag[tag]?.size === 0) delete world.byTag[tag]
  }

  // Remove all components for this entity
  for (const componentType of Object.keys(world.components)) {
    delete world.components[componentType][id]
  }

  delete world.entities[id]
}

export function getEntity(world: World, id: string): Entity | undefined {
  return world.entities[id]
}

export function hasEntity(world: World, id: string): boolean {
  return id in world.entities
}

export function entityCount(world: World): number {
  return Object.keys(world.entities).length
}

// ---------------------------------------------------------------------------
// Tag operations
// ---------------------------------------------------------------------------

export function addTag(world: World, entityId: string, tag: string): void {
  const entity = world.entities[entityId]
  if (!entity) return
  entity.tags.add(tag)
  if (!world.byTag[tag]) world.byTag[tag] = new Set()
  world.byTag[tag].add(entityId)
}

export function removeTag(world: World, entityId: string, tag: string): void {
  const entity = world.entities[entityId]
  if (!entity) return
  entity.tags.delete(tag)
  world.byTag[tag]?.delete(entityId)
  if (world.byTag[tag]?.size === 0) delete world.byTag[tag]
}

export function hasTag(world: World, entityId: string, tag: string): boolean {
  return world.entities[entityId]?.tags.has(tag) ?? false
}

export function queryByTag(world: World, tag: string): string[] {
  const ids = world.byTag[tag]
  if (!ids) return []
  return Array.from(ids)
}

/**
 * Query entities that have ALL specified tags.
 */
export function queryByTags(world: World, tags: string[]): string[] {
  if (tags.length === 0) return Object.keys(world.entities)
  // Start with the smallest set for efficiency
  const sets = tags
    .map(t => world.byTag[t])
    .filter((s): s is Set<string> => s !== undefined)
  if (sets.length !== tags.length) return [] // Some tag has no entities
  sets.sort((a, b) => a.size - b.size)

  const smallest = sets[0]
  const rest = sets.slice(1)
  const result: string[] = []
  for (const id of smallest) {
    if (rest.every(s => s.has(id))) result.push(id)
  }
  return result
}

// ---------------------------------------------------------------------------
// Component CRUD
// ---------------------------------------------------------------------------

/**
 * Set a component on an entity. Creates the component store if needed.
 */
export function setComponent<T>(
  world: World,
  entityId: string,
  componentType: string,
  data: T,
): void {
  if (!world.components[componentType]) {
    world.components[componentType] = {}
  }
  world.components[componentType][entityId] = data
}

/**
 * Get a component from an entity.
 */
export function getComponent<T>(
  world: World,
  entityId: string,
  componentType: string,
): T | undefined {
  return world.components[componentType]?.[entityId] as T | undefined
}

/**
 * Get a component, throw if not found.
 */
export function getComponentOrThrow<T>(
  world: World,
  entityId: string,
  componentType: string,
): T {
  const data = world.components[componentType]?.[entityId]
  if (data === undefined) {
    throw new Error(`Component '${componentType}' not found on entity '${entityId}'`)
  }
  return data as T
}

/**
 * Check if an entity has a specific component.
 */
export function hasComponent(
  world: World,
  entityId: string,
  componentType: string,
): boolean {
  return world.components[componentType]?.[entityId] !== undefined
}

/**
 * Remove a component from an entity.
 */
export function removeComponent(
  world: World,
  entityId: string,
  componentType: string,
): boolean {
  if (!world.components[componentType]) return false
  const existed = entityId in world.components[componentType]
  delete world.components[componentType][entityId]
  return existed
}

/**
 * Get all entity IDs that have a specific component.
 */
export function queryByComponent(world: World, componentType: string): string[] {
  const store = world.components[componentType]
  if (!store) return []
  return Object.keys(store)
}

/**
 * Get all entity IDs that have ALL specified components.
 */
export function queryByComponents(world: World, componentTypes: string[]): string[] {
  if (componentTypes.length === 0) return Object.keys(world.entities)

  // Start with the smallest component store
  const stores = componentTypes
    .map(t => world.components[t])
    .filter((s): s is Record<string, unknown> => s !== undefined)
  if (stores.length !== componentTypes.length) return []

  stores.sort((a, b) => Object.keys(a).length - Object.keys(b).length)
  const smallestKeys = Object.keys(stores[0])
  const rest = stores.slice(1)

  return smallestKeys.filter(id => rest.every(s => id in s))
}

// ---------------------------------------------------------------------------
// ID generation helper
// ---------------------------------------------------------------------------

export function generateId(prefix?: string): string {
  const id = nanoid(12)
  return prefix ? `${prefix}_${id}` : id
}
