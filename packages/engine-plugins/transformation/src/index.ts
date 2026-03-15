// plugin-transformation/src/index.ts
// Generic entity transformation (base swap) system.
// Manages temporary and permanent transformations with priority stacking.

import type { World, Entity } from '@arcadia-eternity/engine'
import { generateId } from '@arcadia-eternity/engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Serializable transformation record — pure data.
 */
export interface TransformRecord {
  id: string
  targetId: string
  targetType: string
  originalBaseId: string
  currentBaseId: string
  transformType: 'temporary' | 'permanent'
  priority: number
  causedById?: string
  isActive: boolean
  createdAt: number
  /** Game-layer specific extra data (e.g. HP ratio for pets) */
  extra: Record<string, unknown>
}

/**
 * Game layers implement this to perform the actual base swap on entities.
 */
export interface TransformStrategy {
  /** Check if this strategy handles the given entity type */
  canHandle(entityType: string): boolean
  /** Perform the base swap on the entity */
  performTransform(world: World, targetId: string, newBaseId: string, record: TransformRecord): void
  /** Restore the entity to its original base */
  restoreOriginal(world: World, targetId: string, originalBaseId: string, record: TransformRecord): void
}

/**
 * Transformation system state — stored in world.meta.
 */
export interface TransformSystemState {
  /** All transformation records: targetId → records */
  records: Record<string, TransformRecord[]>
  /** Temporary transform stacks: targetId → stack (sorted by priority desc) */
  temporaryStacks: Record<string, TransformRecord[]>
  /** Permanent transforms: targetId → record */
  permanentTransforms: Record<string, TransformRecord>
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

const STATE_KEY = '__transformSystem'

/**
 * Get or initialize the transformation system state from world.meta.
 */
export function getTransformState(world: World): TransformSystemState {
  if (!world.meta[STATE_KEY]) {
    world.meta[STATE_KEY] = {
      records: {},
      temporaryStacks: {},
      permanentTransforms: {},
    }
  }
  return world.meta[STATE_KEY] as TransformSystemState
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Apply a transformation to an entity.
 * Returns the created TransformRecord, or null if blocked.
 */
export function applyTransformation(
  world: World,
  targetId: string,
  targetType: string,
  newBaseId: string,
  transformType: 'temporary' | 'permanent',
  strategy: TransformStrategy,
  options?: {
    priority?: number
    causedById?: string
    originalBaseId?: string
    permanentStrategy?: 'preserve_temporary' | 'clear_temporary'
    extra?: Record<string, unknown>
  },
): TransformRecord | null {
  if (!strategy.canHandle(targetType)) return null

  const state = getTransformState(world)
  const priority = options?.priority ?? 0

  // Determine original base
  const existingRecords = state.records[targetId]
  const originalBaseFromExtra = typeof options?.extra?.originalBaseId === 'string'
    ? options.extra.originalBaseId
    : undefined
  const originalBaseId = existingRecords && existingRecords.length > 0
    ? existingRecords[0].originalBaseId
    : (options?.originalBaseId ?? originalBaseFromExtra ?? newBaseId)

  const record: TransformRecord = {
    id: generateId('transform'),
    targetId,
    targetType,
    originalBaseId,
    currentBaseId: newBaseId,
    transformType,
    priority,
    causedById: options?.causedById,
    isActive: true,
    createdAt: Date.now(),
    extra: options?.extra ?? {},
  }

  // Store record
  if (!state.records[targetId]) {
    state.records[targetId] = []
  }
  state.records[targetId].push(record)

  if (transformType === 'temporary') {
    applyTemporary(world, state, record, strategy)
  } else {
    applyPermanent(world, state, record, strategy, options?.permanentStrategy)
  }

  return record
}

/**
 * Remove a transformation from an entity.
 * Returns true if successfully removed.
 */
export function removeTransformation(
  world: World,
  targetId: string,
  strategy: TransformStrategy,
  transformationId?: string,
): boolean {
  const state = getTransformState(world)
  const records = state.records[targetId]
  if (!records || records.length === 0) return false

  let removedRecord: TransformRecord | undefined

  if (transformationId) {
    const idx = records.findIndex(r => r.id === transformationId)
    if (idx === -1) return false
    removedRecord = records.splice(idx, 1)[0]
  } else {
    removedRecord = records.pop()
  }

  if (!removedRecord) return false

  if (removedRecord.transformType === 'temporary') {
    // Remove from temporary stack
    const stack = state.temporaryStacks[targetId]
    if (stack) {
      const idx = stack.findIndex(r => r.id === removedRecord!.id)
      if (idx !== -1) stack.splice(idx, 1)
    }
    // Re-apply top transformation
    reapplyTop(world, state, targetId, strategy, removedRecord)
  } else {
    delete state.permanentTransforms[targetId]
    restoreOriginal(world, state, targetId, strategy, removedRecord)
  }

  // Clean up empty records
  if (records.length === 0) {
    delete state.records[targetId]
    delete state.temporaryStacks[targetId]
    delete state.permanentTransforms[targetId]
  }

  return true
}

/**
 * Remove all transformations caused by a specific source.
 */
export function removeTransformationsBySource(
  world: World,
  causedById: string,
  strategy: TransformStrategy,
): number {
  const state = getTransformState(world)
  let removed = 0

  for (const targetId of Object.keys(state.records)) {
    const records = state.records[targetId]
    const toRemove = records.filter(r => r.causedById === causedById)
    for (const record of toRemove) {
      if (removeTransformation(world, targetId, strategy, record.id)) {
        removed++
      }
    }
  }

  return removed
}

/**
 * Get the current transformation state for an entity.
 */
export function getEntityTransformState(
  world: World,
  targetId: string,
): {
  isTransformed: boolean
  records: TransformRecord[]
  activeRecord?: TransformRecord
} {
  const state = getTransformState(world)
  const records = state.records[targetId] ?? []
  const stack = state.temporaryStacks[targetId]
  const permanent = state.permanentTransforms[targetId]
  const activeRecord = (stack && stack.length > 0) ? stack[0] : permanent

  return {
    isTransformed: records.length > 0,
    records,
    activeRecord,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function applyTemporary(
  world: World,
  state: TransformSystemState,
  record: TransformRecord,
  strategy: TransformStrategy,
): void {
  const targetId = record.targetId

  if (!state.temporaryStacks[targetId]) {
    state.temporaryStacks[targetId] = []
  }

  const stack = state.temporaryStacks[targetId]

  // Remove existing transform from same source
  if (record.causedById) {
    const existingIdx = stack.findIndex(r => r.causedById === record.causedById)
    if (existingIdx !== -1) {
      stack.splice(existingIdx, 1)
    }
  }

  // Insert by priority (descending)
  const insertIdx = stack.findIndex(r => r.priority < record.priority)
  if (insertIdx === -1) {
    stack.push(record)
  } else {
    stack.splice(insertIdx, 0, record)
  }

  // Apply the top (highest priority) transformation
  const top = stack[0]
  strategy.performTransform(world, targetId, top.currentBaseId, top)
}

function applyPermanent(
  world: World,
  state: TransformSystemState,
  record: TransformRecord,
  strategy: TransformStrategy,
  permanentStrategy?: 'preserve_temporary' | 'clear_temporary',
): void {
  const targetId = record.targetId

  if (permanentStrategy === 'clear_temporary' || !permanentStrategy) {
    // Clear temporary stack
    delete state.temporaryStacks[targetId]
  }

  state.permanentTransforms[targetId] = record

  // Only apply if no temporary transforms override it
  const stack = state.temporaryStacks[targetId]
  if (!stack || stack.length === 0) {
    strategy.performTransform(world, targetId, record.currentBaseId, record)
  }
}

function reapplyTop(
  world: World,
  state: TransformSystemState,
  targetId: string,
  strategy: TransformStrategy,
  removedRecord: TransformRecord,
): void {
  const stack = state.temporaryStacks[targetId]

  if (stack && stack.length > 0) {
    // Apply next highest priority
    const top = stack[0]
    strategy.performTransform(world, targetId, top.currentBaseId, top)
  } else {
    // No more temporary transforms — fall back to permanent or original
    const permanent = state.permanentTransforms[targetId]
    if (permanent) {
      strategy.performTransform(world, targetId, permanent.currentBaseId, permanent)
    } else {
      restoreOriginal(world, state, targetId, strategy, removedRecord)
    }
  }
}

function restoreOriginal(
  world: World,
  state: TransformSystemState,
  targetId: string,
  strategy: TransformStrategy,
  record: TransformRecord,
): void {
  strategy.restoreOriginal(world, targetId, record.originalBaseId, record)
}
