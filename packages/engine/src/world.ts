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
// World type slots — marker interfaces that game layers implement
// ---------------------------------------------------------------------------

/** Game-layer state stored in World.state. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorldState {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorldSystems {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorldPlugins {}

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
export interface World<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> {
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
  state: TState
  /** System references (non-serializable, runtime only) */
  systems: TSystems
  /** Plugin private data (serializable, plugin-specific) */
  plugins: TPlugins
  /** Arbitrary metadata (non-serializable, for debugging/profiling) */
  meta: Record<string, unknown>
  /** Current context entity ID for selector entity navigation (runtime, non-serializable) */
  currentContextEntityId?: string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorld<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
>(): World<TState, TSystems, TPlugins> {
  return {
    entities: {},
    byTag: {},
    components: {},
    configStore: createConfigStore(),
    phaseStack: [],
    eventLog: [],
    state: {} as TState,
    systems: {} as TSystems,
    plugins: {} as TPlugins,
    meta: {},
  }
}

// ---------------------------------------------------------------------------
// Entity CRUD
// ---------------------------------------------------------------------------

export function createEntity<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  id?: string,
  tags?: string[],
): Entity {
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

export function removeEntity<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  id: string,
): void {
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

export function getEntity<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  id: string,
): Entity | undefined {
  return world.entities[id]
}

export function hasEntity<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  id: string,
): boolean {
  return id in world.entities
}

export function entityCount<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
): number {
  return Object.keys(world.entities).length
}

// ---------------------------------------------------------------------------
// Tag operations
// ---------------------------------------------------------------------------

export function addTag<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  entityId: string,
  tag: string,
): void {
  const entity = world.entities[entityId]
  if (!entity) return
  entity.tags.add(tag)
  if (!world.byTag[tag]) world.byTag[tag] = new Set()
  world.byTag[tag].add(entityId)
}

export function removeTag<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  entityId: string,
  tag: string,
): void {
  const entity = world.entities[entityId]
  if (!entity) return
  entity.tags.delete(tag)
  world.byTag[tag]?.delete(entityId)
  if (world.byTag[tag]?.size === 0) delete world.byTag[tag]
}

export function hasTag<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  entityId: string,
  tag: string,
): boolean {
  return world.entities[entityId]?.tags.has(tag) ?? false
}

export function queryByTag<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  tag: string,
): string[] {
  const ids = world.byTag[tag]
  if (!ids) return []
  return Array.from(ids)
}

/**
 * Query entities that have ALL specified tags.
 */
export function queryByTags<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  tags: string[],
): string[] {
  if (tags.length === 0) return Object.keys(world.entities)
  // Start with the smallest set for efficiency
  const sets = tags.map(t => world.byTag[t]).filter((s): s is Set<string> => s !== undefined)
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
export function setComponent<
  T,
  TState extends WorldState,
  TSystems extends WorldSystems,
  TPlugins extends WorldPlugins,
>(world: World<TState, TSystems, TPlugins>, entityId: string, componentType: string, data: T): void {
  if (!world.components[componentType]) {
    world.components[componentType] = {}
  }
  world.components[componentType][entityId] = data
}

export function getComponent<
  T,
  TState extends WorldState,
  TSystems extends WorldSystems,
  TPlugins extends WorldPlugins,
>(world: World<TState, TSystems, TPlugins>, entityId: string, componentType: string): T | undefined {
  return world.components[componentType]?.[entityId] as T | undefined
}

export function getComponentOrThrow<
  T,
  TState extends WorldState,
  TSystems extends WorldSystems,
  TPlugins extends WorldPlugins,
>(world: World<TState, TSystems, TPlugins>, entityId: string, componentType: string): T {
  const component = getComponent(world, entityId, componentType)
  if (component === undefined || component === null) {
    throw new Error(`Component '${componentType}' not found on entity '${entityId}'`)
  }
  return component as T
}

export function hasComponent<TState extends WorldState, TSystems extends WorldSystems, TPlugins extends WorldPlugins>(
  world: World<TState, TSystems, TPlugins>,
  entityId: string,
  componentType: string,
): boolean {
  return entityId in (world.components[componentType] ?? {})
}

export function removeComponent<
  TState extends WorldState,
  TSystems extends WorldSystems,
  TPlugins extends WorldPlugins,
>(world: World<TState, TSystems, TPlugins>, entityId: string, componentType: string): boolean {
  if (!world.components[componentType]) return false
  delete world.components[componentType][entityId]
  return true
}

export function queryByComponent<
  TState extends WorldState,
  TSystems extends WorldSystems,
  TPlugins extends WorldPlugins,
>(world: World<TState, TSystems, TPlugins>, componentType: string): string[] {
  const store = world.components[componentType]
  if (!store) return []
  return Object.keys(store)
}

export function queryByComponents<
  TState extends WorldState,
  TSystems extends WorldSystems,
  TPlugins extends WorldPlugins,
>(world: World<TState, TSystems, TPlugins>, componentTypes: string[]): string[] {
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
