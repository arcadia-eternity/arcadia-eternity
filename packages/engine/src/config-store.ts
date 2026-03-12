// engine/src/config-store.ts
// ConfigStore — a scoped, modifier-aware key-value configuration system.
//
// Similar to AttributeStore but for game configuration values.
// Supports scope hierarchy, modifier stacking, and phase-type binding.
// All data is plain and serializable (no RxJS).

import type { PhaseContext } from './attribute.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigValue = string | number | boolean | null

export type ConfigModifierType = 'override' | 'delta' | 'append' | 'prepend'

export type ConfigDurationType = 'instant' | 'binding' | 'phase' | 'phaseType'

export interface ConfigPhaseTypeSpec {
  phaseType: string
  phaseId?: string
  scope: 'current' | 'any' | 'next'
}

/**
 * Serializable config modifier definition — pure data.
 */
export interface ConfigModifierDef {
  id: string
  type: ConfigModifierType
  value: ConfigValue
  priority: number
  sourceId?: string
  durationType: ConfigDurationType
  phaseTypeSpec?: ConfigPhaseTypeSpec
  /** Scope entity ID — modifier only applies when evaluating within this scope or its descendants */
  scopeEntityId?: string
}

/**
 * Per-world config store — pure data, serializable.
 */
export interface ConfigStore {
  /** Base config values: key → value */
  bases: Record<string, ConfigValue>
  /** Modifiers per config key: key → modifiers */
  modifiers: Record<string, ConfigModifierDef[]>
  /** Scoped base overrides: entityId → key → value */
  scopedBases: Record<string, Record<string, ConfigValue>>
  /** Scoped modifiers: entityId → key → modifiers */
  scopedModifiers: Record<string, Record<string, ConfigModifierDef[]>>
  /** Tag associations: tag → set of config keys */
  tagToKeys: Record<string, string[]>
  /** Reverse tag mapping: key → tags */
  keyToTags: Record<string, string[]>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createConfigStore(): ConfigStore {
  return {
    bases: {},
    modifiers: {},
    scopedBases: {},
    scopedModifiers: {},
    tagToKeys: {},
    keyToTags: {},
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerConfig(
  store: ConfigStore,
  key: string,
  initialValue: ConfigValue,
  tags?: string[],
): void {
  store.bases[key] = initialValue
  if (!store.modifiers[key]) {
    store.modifiers[key] = []
  }
  if (tags && tags.length > 0) {
    addConfigTags(store, key, tags)
  }
}

// ---------------------------------------------------------------------------
// Tag management
// ---------------------------------------------------------------------------

export function addConfigTags(store: ConfigStore, key: string, tags: string[]): void {
  if (!store.keyToTags[key]) store.keyToTags[key] = []
  for (const tag of tags) {
    if (!store.keyToTags[key].includes(tag)) {
      store.keyToTags[key].push(tag)
    }
    if (!store.tagToKeys[tag]) store.tagToKeys[tag] = []
    if (!store.tagToKeys[tag].includes(key)) {
      store.tagToKeys[tag].push(key)
    }
  }
}

export function getConfigKeysByTag(store: ConfigStore, tag: string): string[] {
  return store.tagToKeys[tag] ?? []
}

// ---------------------------------------------------------------------------
// Get / Set
// ---------------------------------------------------------------------------

export function setConfigValue(
  store: ConfigStore,
  key: string,
  value: ConfigValue,
  scopeEntityId?: string,
): void {
  if (scopeEntityId) {
    if (!store.scopedBases[scopeEntityId]) {
      store.scopedBases[scopeEntityId] = {}
    }
    store.scopedBases[scopeEntityId][key] = value
  } else {
    store.bases[key] = value
  }
}

/**
 * Get the effective config value, applying modifiers and scope hierarchy.
 *
 * @param scopeEntityId - The entity requesting the value (for scoped lookups)
 * @param getParentScope - Game-layer function to walk up the scope hierarchy
 */
export function getConfigValue(
  store: ConfigStore,
  key: string,
  phaseCtx?: PhaseContext,
  scopeEntityId?: string,
  getParentScope?: (entityId: string) => string | undefined,
): ConfigValue | undefined {
  // 1. Find base value (most specific scope wins)
  let baseValue: ConfigValue | undefined
  if (scopeEntityId && getParentScope) {
    let current: string | undefined = scopeEntityId
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current)) break
      visited.add(current)
      const scopedBases = store.scopedBases[current]
      if (scopedBases && key in scopedBases) {
        baseValue = scopedBases[key]
        break
      }
      current = getParentScope(current)
    }
  }
  if (baseValue === undefined) {
    baseValue = store.bases[key]
  }
  if (baseValue === undefined) return undefined

  // 2. Collect all applicable modifiers
  const allModifiers: ConfigModifierDef[] = []

  // Global modifiers
  const globalMods = store.modifiers[key]
  if (globalMods) allModifiers.push(...globalMods)

  // Scoped modifiers (walk up hierarchy)
  if (scopeEntityId && getParentScope) {
    let current: string | undefined = scopeEntityId
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current)) break
      visited.add(current)
      const scopedMods = store.scopedModifiers[current]?.[key]
      if (scopedMods) allModifiers.push(...scopedMods)
      current = getParentScope(current)
    }
  }

  // 3. Filter by phase context
  const active = allModifiers.filter(m => isConfigModifierActive(m, phaseCtx))

  // 4. Sort by priority descending and apply
  active.sort((a, b) => b.priority - a.priority)
  let result = baseValue
  for (const mod of active) {
    result = applyConfigModifier(result, mod)
  }

  return result
}

// ---------------------------------------------------------------------------
// Modifier CRUD
// ---------------------------------------------------------------------------

export function addConfigModifier(
  store: ConfigStore,
  key: string,
  mod: ConfigModifierDef,
  scopeEntityId?: string,
): void {
  if (scopeEntityId) {
    if (!store.scopedModifiers[scopeEntityId]) {
      store.scopedModifiers[scopeEntityId] = {}
    }
    if (!store.scopedModifiers[scopeEntityId][key]) {
      store.scopedModifiers[scopeEntityId][key] = []
    }
    store.scopedModifiers[scopeEntityId][key].push(mod)
  } else {
    if (!store.modifiers[key]) store.modifiers[key] = []
    store.modifiers[key].push(mod)
  }
}

export function removeConfigModifier(
  store: ConfigStore,
  key: string,
  modId: string,
  scopeEntityId?: string,
): boolean {
  const mods = scopeEntityId
    ? store.scopedModifiers[scopeEntityId]?.[key]
    : store.modifiers[key]
  if (!mods) return false
  const idx = mods.findIndex(m => m.id === modId)
  if (idx === -1) return false
  mods.splice(idx, 1)
  return true
}

export function removeConfigModifiersBySource(
  store: ConfigStore,
  sourceId: string,
): number {
  let removed = 0

  // Global modifiers
  for (const key of Object.keys(store.modifiers)) {
    const before = store.modifiers[key].length
    store.modifiers[key] = store.modifiers[key].filter(m => m.sourceId !== sourceId)
    removed += before - store.modifiers[key].length
  }

  // Scoped modifiers
  for (const entityId of Object.keys(store.scopedModifiers)) {
    for (const key of Object.keys(store.scopedModifiers[entityId])) {
      const before = store.scopedModifiers[entityId][key].length
      store.scopedModifiers[entityId][key] = store.scopedModifiers[entityId][key].filter(
        m => m.sourceId !== sourceId,
      )
      removed += before - store.scopedModifiers[entityId][key].length
    }
  }

  return removed
}

/**
 * Remove all modifiers bound to a specific phase type when that phase completes.
 */
export function cleanupPhaseTypeConfigModifiers(
  store: ConfigStore,
  phaseType: string,
  phaseId?: string,
): number {
  let removed = 0

  function shouldRemove(mod: ConfigModifierDef): boolean {
    if (mod.durationType !== 'phaseType' || !mod.phaseTypeSpec) return false
    if (mod.phaseTypeSpec.phaseType !== phaseType) return false
    if (phaseId && mod.phaseTypeSpec.phaseId && mod.phaseTypeSpec.phaseId !== phaseId) return false
    return true
  }

  // Global
  for (const key of Object.keys(store.modifiers)) {
    const before = store.modifiers[key].length
    store.modifiers[key] = store.modifiers[key].filter(m => !shouldRemove(m))
    removed += before - store.modifiers[key].length
  }

  // Scoped
  for (const entityId of Object.keys(store.scopedModifiers)) {
    for (const key of Object.keys(store.scopedModifiers[entityId])) {
      const before = store.scopedModifiers[entityId][key].length
      store.scopedModifiers[entityId][key] = store.scopedModifiers[entityId][key].filter(
        m => !shouldRemove(m),
      )
      removed += before - store.scopedModifiers[entityId][key].length
    }
  }

  return removed
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isConfigModifierActive(mod: ConfigModifierDef, phaseCtx?: PhaseContext): boolean {
  if (mod.durationType !== 'phaseType' || !mod.phaseTypeSpec || !phaseCtx) {
    return true
  }
  const spec = mod.phaseTypeSpec
  if (!phaseCtx.activePhaseTypes.has(spec.phaseType)) return false
  if (spec.phaseId) {
    const currentId = phaseCtx.currentPhaseIds.get(spec.phaseType)
    if (currentId !== spec.phaseId) return false
  }
  return true
}

function applyConfigModifier(base: ConfigValue, mod: ConfigModifierDef): ConfigValue {
  switch (mod.type) {
    case 'override':
      return mod.value

    case 'delta':
      if (typeof base === 'number' && typeof mod.value === 'number') {
        return base + mod.value
      }
      return base

    case 'append':
      if (typeof base === 'string' && typeof mod.value === 'string') {
        return base + mod.value
      }
      return base

    case 'prepend':
      if (typeof base === 'string' && typeof mod.value === 'string') {
        return mod.value + base
      }
      return base

    default:
      return base
  }
}
