// engine/src/snapshot.ts
// Snapshot / Restore — serialize and deserialize the entire World.
//
// World is plain data except for Set objects in byTag index,
// which we convert to arrays for JSON serialization.

import type { World } from './world.js'
import { createWorld } from './world.js'

// ---------------------------------------------------------------------------
// Serializable representation
// ---------------------------------------------------------------------------

interface SerializedWorld {
  entities: Record<string, { id: string; tags: string[] }>
  byTag: Record<string, string[]>
  components: World['components']
  configStore: World['configStore']
  phaseStack: World['phaseStack']
  eventLog: World['eventLog']
  state: World['state']
  plugins: World['plugins']
  meta: World['meta']
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function createSnapshot(world: World): string {
  const serialized: SerializedWorld = {
    entities: serializeEntities(world.entities),
    byTag: serializeTagIndex(world.byTag),
    components: world.components,
    configStore: world.configStore,
    phaseStack: world.phaseStack,
    eventLog: world.eventLog,
    state: world.state,
    plugins: world.plugins,
    meta: world.meta,
  }
  return JSON.stringify(serialized)
}

export function cloneWorld(world: World): World {
  return restoreWorld(createSnapshot(world))
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export function restoreWorld(json: string): World {
  const parsed: SerializedWorld = JSON.parse(json)
  const world = createWorld()

  world.entities = deserializeEntities(parsed.entities)
  world.byTag = deserializeTagIndex(parsed.byTag)
  world.components = parsed.components ?? {}
  world.configStore = parsed.configStore ?? world.configStore
  world.phaseStack = parsed.phaseStack ?? []
  world.eventLog = parsed.eventLog ?? []
  world.state = parsed.state ?? {}
  world.plugins = parsed.plugins ?? {}
  world.meta = parsed.meta ?? {}

  return world
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeEntities(
  entities: Record<string, { id: string; tags: Set<string> }>,
): Record<string, { id: string; tags: string[] }> {
  const result: Record<string, { id: string; tags: string[] }> = {}
  for (const [id, entity] of Object.entries(entities)) {
    result[id] = { id: entity.id, tags: Array.from(entity.tags) }
  }
  return result
}

function deserializeEntities(
  entities: Record<string, { id: string; tags: string[] }>,
): Record<string, { id: string; tags: Set<string> }> {
  const result: Record<string, { id: string; tags: Set<string> }> = {}
  for (const [id, entity] of Object.entries(entities)) {
    result[id] = { id: entity.id, tags: new Set(entity.tags) }
  }
  return result
}

function serializeTagIndex(byTag: Record<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [tag, ids] of Object.entries(byTag)) {
    result[tag] = Array.from(ids)
  }
  return result
}

function deserializeTagIndex(byTag: Record<string, string[]>): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {}
  for (const [tag, ids] of Object.entries(byTag)) {
    result[tag] = new Set(ids)
  }
  return result
}
