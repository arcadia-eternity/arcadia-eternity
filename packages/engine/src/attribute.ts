// engine/src/attribute.ts
// Pull-based AttributeSystem — no RxJS, fully synchronous, plain data.
//
// AttributeStore is a component (plain data, stored in world.components).
// AttributeSystem is a class that operates on AttributeStore components.

import type { World, WorldState, WorldSystems, WorldPlugins } from './world.js'
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

export type ModifierValue = { kind: 'static'; value: AttributeValue } | { kind: 'expr'; expr: unknown }

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
 *
 * @typeParam TAttributes - Map of attribute key → value type. Use to narrow
 *   attribute types at compile time. Defaults to `Record<string, AttributeValue>`
 *   for untyped usage.
 */
export interface AttributeStore<TAttributes = Record<string, AttributeValue>> {
  objectId: string
  bases: { [K in keyof TAttributes]?: TAttributes[K] }
  modifiers: { [K in keyof TAttributes]?: ModifierDef[] }
}

/**
 * Game layer implements this to resolve DSL expressions inside modifiers.
 */
export interface ExpressionResolver<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> {
  evaluate(world: World<TState, TSystems, TPlugins>, expr: unknown, computeStack: Set<string>): number
}

/**
 * Phase context for modifier activation checks.
 */
export interface PhaseContext {
  activePhaseTypes: Set<symbol>
  currentPhaseIds: Map<symbol, string>
}

export interface AttributeWriteGuardContext<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> {
  world: World<TState, TSystems, TPlugins>
  entityId: string
  key: string
  operation: 'setBaseValue' | 'addModifier'
}

export type AttributeWriteGuard<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> = (ctx: AttributeWriteGuardContext<TState, TSystems, TPlugins>) => boolean

export interface AttributeBaseValueSetContext<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> {
  world: World<TState, TSystems, TPlugins>
  entityId: string
  key: string
  value: AttributeValue
}

export type AttributeBaseValueSetHook<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
> = (ctx: AttributeBaseValueSetContext<TState, TSystems, TPlugins>) => void

// ---------------------------------------------------------------------------
// AttributeSystem — class that operates on AttributeStore components
// ---------------------------------------------------------------------------

const MAX_COMPUTE_DEPTH = 10

export class AttributeSystem<
  TState extends WorldState = WorldState,
  TSystems extends WorldSystems = WorldSystems,
  TPlugins extends WorldPlugins = WorldPlugins,
  TAttributes = Record<string, AttributeValue>,
> {
  private writeGuard?: AttributeWriteGuard<TState, TSystems, TPlugins>
  private baseValueSetHook?: AttributeBaseValueSetHook<TState, TSystems, TPlugins>

  constructor(private resolver?: ExpressionResolver<TState, TSystems, TPlugins>) {}

  setResolver(resolver: ExpressionResolver<TState, TSystems, TPlugins>): void {
    this.resolver = resolver
  }

  setWriteGuard(guard: AttributeWriteGuard<TState, TSystems, TPlugins> | undefined): void {
    this.writeGuard = guard
  }

  setBaseValueSetHook(hook: AttributeBaseValueSetHook<TState, TSystems, TPlugins> | undefined): void {
    this.baseValueSetHook = hook
  }

  // -----------------------------------------------------------------------
  // Store lifecycle (component CRUD)
  // -----------------------------------------------------------------------

  /** Create and attach an AttributeStore component to an entity. */
  create(world: World<TState, TSystems, TPlugins>, entityId: string): AttributeStore<TAttributes> {
    const store: AttributeStore<TAttributes> = { objectId: entityId, bases: {}, modifiers: {} }
    setComponent(world, entityId, ATTRIBUTE_STORE, store)
    return store
  }

  /** Get the AttributeStore for an entity, or undefined. */
  get(world: World<TState, TSystems, TPlugins>, entityId: string): AttributeStore<TAttributes> | undefined {
    return getComponent<AttributeStore<TAttributes>, TState, TSystems, TPlugins>(world, entityId, ATTRIBUTE_STORE)
  }

  /** Get the AttributeStore for an entity, throw if missing. */
  getOrThrow(world: World<TState, TSystems, TPlugins>, entityId: string): AttributeStore<TAttributes> {
    const store = this.get(world, entityId)
    if (!store) throw new Error(`No AttributeStore on entity '${entityId}'`)
    return store
  }

  /** Get or create an AttributeStore for an entity. */
  getOrCreate(world: World<TState, TSystems, TPlugins>, entityId: string): AttributeStore<TAttributes> {
    return this.get(world, entityId) ?? this.create(world, entityId)
  }

  /** Remove the AttributeStore component from an entity. */
  remove(world: World<TState, TSystems, TPlugins>, entityId: string): boolean {
    return removeComponent(world, entityId, ATTRIBUTE_STORE)
  }

  // -----------------------------------------------------------------------
  // Attribute registration
  // -----------------------------------------------------------------------

  registerAttribute<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
    initial: TAttributes[K],
  ): void {
    const store = this.getOrCreate(world, entityId)
    store.bases[key] = initial
    if (!store.modifiers[key]) store.modifiers[key] = []
  }

  setBaseValue<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
    value: TAttributes[K],
  ): void {
    this.ensureWriteAllowed(world, entityId, key as string, 'setBaseValue')
    const store = this.getOrThrow(world, entityId)
    if (!(key in store.bases)) {
      throw new Error(`Attribute '${String(key)}' is not registered on entity '${entityId}'`)
    }
    store.bases[key] = value
    if (this.baseValueSetHook) {
      this.baseValueSetHook({ world, entityId, key: key as string, value: value as AttributeValue })
    }
  }

  getBaseValue<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
  ): TAttributes[K] | undefined {
    return this.get(world, entityId)?.bases[key]
  }

  // -----------------------------------------------------------------------
  // Modifier CRUD
  // -----------------------------------------------------------------------

  addModifier<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
    mod: ModifierDef,
  ): void {
    this.ensureWriteAllowed(world, entityId, key as string, 'addModifier')
    const store = this.getOrThrow(world, entityId)
    if (!(key in store.bases)) {
      throw new Error(`Attribute '${String(key)}' is not registered on entity '${entityId}'`)
    }
    if (!store.modifiers[key]) store.modifiers[key] = []
    store.modifiers[key].push(mod)
  }

  removeModifier<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
    modId: string,
  ): boolean {
    const store = this.get(world, entityId)
    if (!store) return false
    const mods = store.modifiers[key]
    if (!mods) return false
    const idx = mods.findIndex(m => m.id === modId)
    if (idx === -1) return false
    mods.splice(idx, 1)
    return true
  }

  removeModifiersBySource(world: World<TState, TSystems, TPlugins>, entityId: string, sourceId: string): number {
    const store = this.get(world, entityId)
    if (!store) return 0
    let removed = 0
    // Mapped type prevents direct indexed assignment; cast to plain Record for mutation.
    const mods = store.modifiers as Record<string, ModifierDef[] | undefined>
    for (const key of Object.keys(mods)) {
      const list = mods[key]
      if (!list) continue
      const before = list.length
      mods[key] = list.filter(m => m.sourceId !== sourceId)
      removed += before - (mods[key]?.length ?? 0)
    }
    return removed
  }

  getModifiers<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
  ): ModifierDef[] {
    return this.get(world, entityId)?.modifiers[key] ?? []
  }

  clearModifiers<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
  ): void {
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
  getValue<K extends keyof TAttributes>(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    key: K,
    phaseCtx?: PhaseContext,
    computeStack?: Set<string>,
  ): TAttributes[K] {
    const store = this.get(world, entityId)
    if (!store) return 0 as TAttributes[K]
    return this.evaluate(world, store, key as string, phaseCtx, computeStack) as TAttributes[K]
  }

  /** Get all effective values for an entity. */
  getAllValues(
    world: World<TState, TSystems, TPlugins>,
    entityId: string,
    phaseCtx?: PhaseContext,
  ): { [K in keyof TAttributes]: TAttributes[K] } {
    const store = this.get(world, entityId)
    if (!store) return {} as { [K in keyof TAttributes]: TAttributes[K] }
    const result: Record<string, AttributeValue> = {}
    for (const key of Object.keys(store.bases)) {
      result[key] = this.evaluate(world, store, key, phaseCtx)
    }
    return result as { [K in keyof TAttributes]: TAttributes[K] }
  }

  // -----------------------------------------------------------------------
  // Internal evaluation
  // -----------------------------------------------------------------------

  private evaluate(
    world: World<TState, TSystems, TPlugins>,
    store: AttributeStore<TAttributes>,
    key: string,
    phaseCtx?: PhaseContext,
    computeStack?: Set<string>,
  ): AttributeValue {
    const stack = computeStack ?? new Set<string>()
    const globalKey = `${store.objectId}.${key}`
    // Narrow to unindexed records for internal string-key access.
    const bases = store.bases as Record<string, AttributeValue | undefined>
    const modifiers = store.modifiers as Record<string, ModifierDef[] | undefined>

    if (stack.has(globalKey)) return bases[key] ?? 0
    if (stack.size >= MAX_COMPUTE_DEPTH) return bases[key] ?? 0

    stack.add(globalKey)
    try {
      const base = bases[key]
      if (base === undefined) return 0

      const mods = modifiers[key]
      if (!mods || mods.length === 0) return base

      const active = mods.filter(m => this.isModifierActive(m, phaseCtx)).sort((a, b) => b.priority - a.priority)

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
    const phaseSym = Symbol.for(spec.phaseType)
    if (!phaseCtx.activePhaseTypes.has(phaseSym)) return false
    if (spec.phaseId) {
      const currentId = phaseCtx.currentPhaseIds.get(phaseSym)
      if (currentId !== spec.phaseId) return false
    }
    return true
  }

  private resolveModifierValue(
    world: World<TState, TSystems, TPlugins>,
    mv: ModifierValue,
    computeStack: Set<string>,
  ): AttributeValue {
    if (mv.kind === 'static') return mv.value
    if (!this.resolver) throw new Error('ExpressionResolver required for expr modifier values')
    return this.resolver.evaluate(world, mv.expr, computeStack)
  }

  private ensureWriteAllowed(
    world: World<TState, TSystems, TPlugins>,
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
    world: World<TState, TSystems, TPlugins>,
    computeStack: Set<string>,
  ): AttributeValue {
    const modValue = this.resolveModifierValue(world, mod.value, computeStack)

    switch (mod.type) {
      case 'percent':
        return typeof current === 'number' && typeof modValue === 'number' ? current * (1 + modValue / 100) : current
      case 'delta':
        return typeof current === 'number' && typeof modValue === 'number' ? current + modValue : current
      case 'override':
        return modValue
      case 'clampMax':
        return typeof current === 'number' && typeof modValue === 'number' ? Math.min(current, modValue) : current
      case 'clampMin':
        return typeof current === 'number' && typeof modValue === 'number' ? Math.max(current, modValue) : current
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
