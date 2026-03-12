// engine/src/attribute.ts
// Pull-based AttributeSystem — no RxJS, fully synchronous, plain data.
//
// AttributeStore is a component (plain data, stored in world.components).
// AttributeSystem is a class that operates on AttributeStore components.

import type { World } from './world.js'
import { getComponent, setComponent, removeComponent } from './world.js'

// ---------------------------------------------------------------------------
// Component name
// ---------------------------------------------------------------------------

export const ATTRIBUTE_STORE = 'attributeStore' as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributeValue =
  | number
  | boolean
  | string
  | [number, number]
  | string[]
  | Record<string, unknown>
  | unknown[]
  | null

export type ModifierType = 'percent' | 'delta' | 'override' | 'clampMax' | 'clampMin' | 'clamp'

export type DurationType = 'instant' | 'binding' | 'phaseType'

export interface PhaseTypeSpec {
  phaseType: string
  phaseId?: string
  scope: 'current' | 'any' | 'next'
}

export type ModifierValue =
  | { kind: 'static'; value: AttributeValue }
  | { kind: 'expr'; expr: unknown }

export interface ModifierDef {
  id: string
  type: ModifierType
  value: ModifierValue
  priority: number
  sourceId?: string
  durationType: DurationType
  phaseTypeSpec?: PhaseTypeSpec
  minValue?: ModifierValue
  maxValue?: ModifierValue
}

/**
 * Per-entity attribute store — pure data component, serializable.
 */
export interface AttributeStore {
  objectId: string
  bases: Record<string, AttributeValue>
  modifiers: Record<string, ModifierDef[]>
}

/**
 * Game layer implements this to resolve DSL expressions inside modifiers.
 */
export interface ExpressionResolver {
  evaluate(world: World, expr: unknown, computeStack: Set<string>): number
}

/**
 * Phase context for modifier activation checks.
 */
export interface PhaseContext {
  activePhaseTypes: Set<string>
  currentPhaseIds: Map<string, string>
}

export interface AttributeWriteGuardContext {
  world: World
  entityId: string
  key: string
  operation: 'setBaseValue' | 'addModifier'
}

export type AttributeWriteGuard = (ctx: AttributeWriteGuardContext) => boolean

export interface AttributeBaseValueSetContext {
  world: World
  entityId: string
  key: string
  value: AttributeValue
}

export type AttributeBaseValueSetHook = (ctx: AttributeBaseValueSetContext) => void

// ---------------------------------------------------------------------------
// AttributeSystem — class that operates on AttributeStore components
// ---------------------------------------------------------------------------

const MAX_COMPUTE_DEPTH = 10

export class AttributeSystem {
  private writeGuard?: AttributeWriteGuard
  private baseValueSetHook?: AttributeBaseValueSetHook

  constructor(
    private resolver?: ExpressionResolver,
  ) {}

  setResolver(resolver: ExpressionResolver): void {
    this.resolver = resolver
  }

  setWriteGuard(guard: AttributeWriteGuard | undefined): void {
    this.writeGuard = guard
  }

  setBaseValueSetHook(hook: AttributeBaseValueSetHook | undefined): void {
    this.baseValueSetHook = hook
  }

  // -----------------------------------------------------------------------
  // Store lifecycle (component CRUD)
  // -----------------------------------------------------------------------

  /** Create and attach an AttributeStore component to an entity. */
  create(world: World, entityId: string): AttributeStore {
    const store: AttributeStore = { objectId: entityId, bases: {}, modifiers: {} }
    setComponent(world, entityId, ATTRIBUTE_STORE, store)
    return store
  }

  /** Get the AttributeStore for an entity, or undefined. */
  get(world: World, entityId: string): AttributeStore | undefined {
    return getComponent<AttributeStore>(world, entityId, ATTRIBUTE_STORE)
  }

  /** Get the AttributeStore for an entity, throw if missing. */
  getOrThrow(world: World, entityId: string): AttributeStore {
    const store = this.get(world, entityId)
    if (!store) throw new Error(`No AttributeStore on entity '${entityId}'`)
    return store
  }

  /** Get or create an AttributeStore for an entity. */
  getOrCreate(world: World, entityId: string): AttributeStore {
    return this.get(world, entityId) ?? this.create(world, entityId)
  }

  /** Remove the AttributeStore component from an entity. */
  remove(world: World, entityId: string): boolean {
    return removeComponent(world, entityId, ATTRIBUTE_STORE)
  }

  // -----------------------------------------------------------------------
  // Attribute registration
  // -----------------------------------------------------------------------

  registerAttribute(world: World, entityId: string, key: string, initial: AttributeValue): void {
    const store = this.getOrCreate(world, entityId)
    store.bases[key] = initial
    if (!store.modifiers[key]) store.modifiers[key] = []
  }

  setBaseValue(world: World, entityId: string, key: string, value: AttributeValue): void {
    this.ensureWriteAllowed(world, entityId, key, 'setBaseValue')
    const store = this.getOrThrow(world, entityId)
    if (!(key in store.bases)) {
      throw new Error(`Attribute '${key}' is not registered on entity '${entityId}'`)
    }
    store.bases[key] = value
    if (this.baseValueSetHook) {
      this.baseValueSetHook({ world, entityId, key, value })
    }
  }

  getBaseValue(world: World, entityId: string, key: string): AttributeValue | undefined {
    return this.get(world, entityId)?.bases[key]
  }

  // -----------------------------------------------------------------------
  // Modifier CRUD
  // -----------------------------------------------------------------------

  addModifier(world: World, entityId: string, key: string, mod: ModifierDef): void {
    this.ensureWriteAllowed(world, entityId, key, 'addModifier')
    const store = this.getOrThrow(world, entityId)
    if (!(key in store.bases)) {
      throw new Error(`Attribute '${key}' is not registered on entity '${entityId}'`)
    }
    if (!store.modifiers[key]) store.modifiers[key] = []
    store.modifiers[key].push(mod)
  }

  removeModifier(world: World, entityId: string, key: string, modId: string): boolean {
    const store = this.get(world, entityId)
    if (!store) return false
    const mods = store.modifiers[key]
    if (!mods) return false
    const idx = mods.findIndex(m => m.id === modId)
    if (idx === -1) return false
    mods.splice(idx, 1)
    return true
  }

  removeModifiersBySource(world: World, entityId: string, sourceId: string): number {
    const store = this.get(world, entityId)
    if (!store) return 0
    let removed = 0
    for (const key of Object.keys(store.modifiers)) {
      const before = store.modifiers[key].length
      store.modifiers[key] = store.modifiers[key].filter(m => m.sourceId !== sourceId)
      removed += before - store.modifiers[key].length
    }
    return removed
  }

  getModifiers(world: World, entityId: string, key: string): ModifierDef[] {
    return this.get(world, entityId)?.modifiers[key] ?? []
  }

  clearModifiers(world: World, entityId: string, key: string): void {
    const store = this.get(world, entityId)
    if (store) store.modifiers[key] = []
  }

  // -----------------------------------------------------------------------
  // Evaluation
  // -----------------------------------------------------------------------

  /**
   * Compute the effective value of an attribute, applying all active modifiers.
   * Pull-based: call whenever you need the current value.
   */
  getValue(
    world: World,
    entityId: string,
    key: string,
    phaseCtx?: PhaseContext,
    computeStack?: Set<string>,
  ): AttributeValue {
    const store = this.get(world, entityId)
    if (!store) return 0
    return this.evaluate(world, store, key, phaseCtx, computeStack)
  }

  /** Get all effective values for an entity. */
  getAllValues(
    world: World,
    entityId: string,
    phaseCtx?: PhaseContext,
  ): Record<string, AttributeValue> {
    const store = this.get(world, entityId)
    if (!store) return {}
    const result: Record<string, AttributeValue> = {}
    for (const key of Object.keys(store.bases)) {
      result[key] = this.evaluate(world, store, key, phaseCtx)
    }
    return result
  }

  // -----------------------------------------------------------------------
  // Internal evaluation
  // -----------------------------------------------------------------------

  private evaluate(
    world: World,
    store: AttributeStore,
    key: string,
    phaseCtx?: PhaseContext,
    computeStack?: Set<string>,
  ): AttributeValue {
    const stack = computeStack ?? new Set<string>()
    const globalKey = `${store.objectId}.${key}`

    if (stack.has(globalKey)) return store.bases[key] ?? 0
    if (stack.size >= MAX_COMPUTE_DEPTH) return store.bases[key] ?? 0

    stack.add(globalKey)
    try {
      const base = store.bases[key]
      if (base === undefined) return 0

      const mods = store.modifiers[key]
      if (!mods || mods.length === 0) return base

      const active = mods
        .filter(m => this.isModifierActive(m, phaseCtx))
        .sort((a, b) => b.priority - a.priority)

      let result: AttributeValue = base
      for (const mod of active) {
        result = this.applyModifier(result, mod, world, stack)
      }
      return result
    } finally {
      stack.delete(globalKey)
    }
  }

  private isModifierActive(mod: ModifierDef, phaseCtx?: PhaseContext): boolean {
    if (mod.durationType !== 'phaseType' || !mod.phaseTypeSpec || !phaseCtx) return true
    const spec = mod.phaseTypeSpec
    if (!phaseCtx.activePhaseTypes.has(spec.phaseType)) return false
    if (spec.phaseId) {
      const currentId = phaseCtx.currentPhaseIds.get(spec.phaseType)
      if (currentId !== spec.phaseId) return false
    }
    return true
  }

  private resolveModifierValue(world: World, mv: ModifierValue, computeStack: Set<string>): AttributeValue {
    if (mv.kind === 'static') return mv.value
    if (!this.resolver) throw new Error('ExpressionResolver required for expr modifier values')
    return this.resolver.evaluate(world, mv.expr, computeStack)
  }

  private ensureWriteAllowed(
    world: World,
    entityId: string,
    key: string,
    operation: 'setBaseValue' | 'addModifier',
  ): void {
    if (!this.writeGuard) return
    const allowed = this.writeGuard({ world, entityId, key, operation })
    if (allowed) return
    throw new Error(`Attribute write denied: ${operation}(${entityId}, ${key})`)
  }

  private applyModifier(
    current: AttributeValue,
    mod: ModifierDef,
    world: World,
    computeStack: Set<string>,
  ): AttributeValue {
    const modValue = this.resolveModifierValue(world, mod.value, computeStack)

    switch (mod.type) {
      case 'percent':
        return typeof current === 'number' && typeof modValue === 'number'
          ? current * (1 + modValue / 100)
          : current
      case 'delta':
        return typeof current === 'number' && typeof modValue === 'number'
          ? current + modValue
          : current
      case 'override':
        return modValue
      case 'clampMax':
        return typeof current === 'number' && typeof modValue === 'number'
          ? Math.min(current, modValue)
          : current
      case 'clampMin':
        return typeof current === 'number' && typeof modValue === 'number'
          ? Math.max(current, modValue)
          : current
      case 'clamp': {
        if (typeof current !== 'number') return current
        let result = current
        if (mod.minValue !== undefined) {
          const minValue = this.resolveModifierValue(world, mod.minValue, computeStack)
          if (typeof minValue === 'number') {
            result = Math.max(result, minValue)
          }
        }
        if (mod.maxValue !== undefined) {
          const maxValue = this.resolveModifierValue(world, mod.maxValue, computeStack)
          if (typeof maxValue === 'number') {
            result = Math.min(result, maxValue)
          }
        }
        return result
      }
      default:
        return current
    }
  }
}
