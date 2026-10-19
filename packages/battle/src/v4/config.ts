import { rememberModifierCleanup, deactivateCleanup, describeCleanup } from './snapshotBindings'
import type { baseMarkId, baseSkillId, markId, petId, playerId, skillId, speciesId } from '@arcadia-eternity/const'
import { Signal, ReactiveValue, isReactiveValue, untracked } from './reactiveValue'
import type { Battle } from './battle'
import { AttributeSystem } from './attributeSystem'
import type { MarkInstance } from './mark'
import type { Pet } from './pet'
import type { Player } from './player'
import type { SkillInstance } from './skill'
import type { BattlePhaseBase } from './phase'
import { createChildLogger, type BattleLogger } from './logger'

export type ScopeObject = MarkInstance | SkillInstance | Pet | Player | Battle | BattlePhaseBase
export type ConfigValue =
  | string
  | number
  | boolean
  | markId
  | skillId
  | petId
  | playerId
  | baseMarkId
  | baseSkillId
  | speciesId
  | null

export enum ConfigModifierType {
  override = 'override',
  delta = 'delta', // For numeric values only
  append = 'append', // For string values only
  prepend = 'prepend', // For string values only
}

export enum ConfigDurationType {
  instant = 'instant',
  binding = 'binding', // Bound to source lifecycle
  phase = 'phase', // Bound to phase lifecycle
  phaseType = 'phaseType', // Bound to specific phase type completion
}

/**
 * Phase type specification for phaseType duration type
 */
export interface PhaseTypeSpec {
  phaseType: PhaseType // Type of phase to bind to
  phaseId?: string // Optional: specific phase ID
  scope: PhaseScope // Scope of the binding
}

/**
 * Game-meaningful phase types that users care about
 */
export enum PhaseType {
  Turn = 'turn', // 回合
  Skill = 'skill', // 技能使用
  Damage = 'damage', // 伤害计算
  Heal = 'heal', // 治疗
  Effect = 'effect', // 效果处理
  Switch = 'switch', // 切换精灵
  Mark = 'mark', // 印记处理
  Rage = 'rage', // 怒气处理
  Battle = 'battle', // 整个战斗
}

/**
 * Scope defines when the modifier should be removed
 */
export enum PhaseScope {
  Current = 'current', // 当前这一次 (e.g., 当前这次技能使用)
  Any = 'any', // 任何一次 (e.g., 任何一次技能使用)
  Next = 'next', // 下一次 (e.g., 下一次伤害)
}

/**
 * ConfigModifier handles modifications to config values
 * Similar to Modifier but specialized for config values
 */
export class ConfigModifier {
  public value: ReactiveValue<ConfigValue>

  constructor(
    public durationType: ConfigDurationType,
    public id: string,
    initialValue: ConfigValue | ReactiveValue<ConfigValue>,
    public type: ConfigModifierType,
    public priority: number,
    public source?: MarkInstance | SkillInstance | BattlePhaseBase,
    public phaseTypeSpec?: PhaseTypeSpec, // For phaseType duration type
  ) {
    this.value = isReactiveValue(initialValue) ? (initialValue as ReactiveValue<ConfigValue>) : new Signal(initialValue)
  }

  /**
   * Apply this modifier to a base value
   */
  apply(base: ConfigValue): ConfigValue {
    const modifierValue = this.value.value

    switch (this.type) {
      case ConfigModifierType.override:
        return modifierValue

      case ConfigModifierType.delta:
        if (typeof base === 'number' && typeof modifierValue === 'number') {
          return base + modifierValue
        }
        throw new Error(`Delta modifier can only be applied to numeric values`)

      case ConfigModifierType.append:
        if (typeof base === 'string' && typeof modifierValue === 'string') {
          return base + modifierValue
        }
        throw new Error(`Append modifier can only be applied to string values`)

      case ConfigModifierType.prepend:
        if (typeof base === 'string' && typeof modifierValue === 'string') {
          return modifierValue + base
        }
        throw new Error(`Prepend modifier can only be applied to string values`)

      default:
        return base
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {}
}

/**
 * Enhanced ConfigSystem with modifier support
 * Supports dynamic config value modification through modifiers
 * Now supports non-singleton mode for battle instance isolation
 */
export class ConfigSystem {
  private static battleConfigs = new Map<string, ConfigSystem>()
  static bindBattle(battle: Battle): void {
    this.battleConfigs.set(battle.id, battle.configSystem)
  }
  static getBattleConfig(battleId: string): ConfigSystem | undefined {
    return this.battleConfigs.get(battleId)
  }
  private static instance: ConfigSystem | null = null
  private static battleRegistry: Map<string, Set<ConfigSystem>> = new Map()
  private readonly logger: BattleLogger = createChildLogger('ConfigSystem')

  // Modifier support
  private baseConfigs: Map<string, Signal<ConfigValue>> = new Map()
  private modifiers: Map<string, Signal<ConfigModifier[]>> = new Map()
  private modifiersBySource: Map<string, Map<string, ConfigModifier[]>> = new Map()

  // Scoped map membership is observable even before a particular scope has a value/modifier.
  private scopeRevision = new Signal(0)
  private publishScopes(): void {
    this.scopeRevision.next(untracked(() => this.scopeRevision.value) + 1)
  }

  private scopedBaseConfigs: Map<ScopeObject, Map<string, Signal<ConfigValue>>> = new Map()
  private scopedModifiers: Map<ScopeObject, Map<string, ConfigModifier[]>> = new Map()

  // Phase type tracking
  private phaseStack: BattlePhaseBase[] = [] // Current phase execution stack
  private phaseBindings = new Map<
    object,
    { spec: PhaseTypeSpec; boundId?: string; excluded: Set<string>; cleanup: () => void }
  >()
  private modifierCleanups = new Map<ConfigModifier, () => void>()
  private phaseTypeInstances: Map<PhaseType, BattlePhaseBase[]> = new Map() // Track instances by type

  // Tagged configuration system
  private tagToConfigKeys: Map<string, Set<string>> = new Map()
  private configKeyToTags: Map<string, Set<string>> = new Map()

  // Lifecycle management
  private isDestroyed: boolean = false
  private battleId?: string
  private allSubscriptions: { unsubscribe(): void }[] = []

  constructor(battleId?: string) {
    this.battleId = battleId

    // Register this instance with the battle if battleId is provided
    if (battleId) {
      this.registerWithBattle(battleId)
    }
  }

  /**
   * Get the global singleton instance (for backward compatibility)
   * @deprecated Use createInstance() for new battle instances
   */
  static getInstance() {
    if (!ConfigSystem.instance) {
      ConfigSystem.instance = new ConfigSystem()
    }
    return ConfigSystem.instance
  }
  /**
   * Create a new ConfigSystem instance for a battle
   * This ensures battle instances don't interfere with each other
   * The new instance will inherit global instance keys, values, and tags
   */
  static createInstance(battleId?: string): ConfigSystem {
    const newInstance = new ConfigSystem(battleId)

    // Copy global instance keys and values
    if (ConfigSystem.instance) {
      for (const [key, subject] of ConfigSystem.instance.baseConfigs.entries()) {
        if (!newInstance.baseConfigs.has(key)) {
          if (ConfigSystem.instance.configKeyToTags.has(key)) {
            const tags = Array.from(ConfigSystem.instance.configKeyToTags.get(key)!)
            newInstance.registerTaggedConfig(key, subject.value, tags)
          } else {
            newInstance.registerConfig(key, subject.value)
          }
        }
      }
    }

    return newInstance
  }

  public exportSnapshotState() {
    if (
      this.isDestroyed ||
      this.phaseBindings.size ||
      [...this.modifierCleanups.keys()].some(
        m => m.durationType === ConfigDurationType.phase || m.durationType === ConfigDurationType.phaseType,
      )
    )
      throw new Error('Snapshot does not yet support active phase-bound config modifiers')
    return {
      base: new Map([...this.baseConfigs].map(([key, value]) => [key, value.value])),
      global: new Map([...this.modifiers].map(([key, value]) => [key, value.value])),
      scopedBase: new Map(
        [...this.scopedBaseConfigs].map(([scope, entries]) => [
          scope,
          new Map([...entries].map(([key, value]) => [key, value.value])),
        ]),
      ),
      scopedModifiers: this.scopedModifiers,
      tags: this.configKeyToTags,
    }
  }
  public restoreSnapshotState(state: ReturnType<ConfigSystem['exportSnapshotState']>): void {
    const lists = [
      ...state.global.values(),
      ...[...state.scopedModifiers.values()].flatMap(entries => [...entries.values()]),
    ]
    for (const modifiers of lists)
      for (const modifier of modifiers)
        if (
          modifier.durationType === ConfigDurationType.phase ||
          modifier.durationType === ConfigDurationType.phaseType
        )
          throw new Error('Snapshot does not yet support active phase-bound config modifiers')
    this.cleanup()
    for (const [key, value] of state.base) this.registerConfig(key, value)
    for (const [key, tags] of state.tags) this.addConfigTags(key, [...tags])
    for (const [scope, entries] of state.scopedBase) for (const [key, value] of entries) this.set(key, value, scope)
    for (const [key, modifiers] of state.global)
      for (const modifier of modifiers) this.addScopedConfigModifier(key, modifier)
    for (const [scope, entries] of state.scopedModifiers)
      for (const [key, modifiers] of entries)
        for (const modifier of modifiers) this.addScopedConfigModifier(key, modifier, scope)
  }

  /**
   * Register this instance with a battle for lifecycle management
   */
  public registerRestoredBattle(battleId: string): void {
    this.battleId = battleId
    this.registerWithBattle(battleId)
  }
  static unbindRestoredBattle(battle: Battle): void {
    if (this.battleConfigs.get(battle.id) === battle.configSystem) this.battleConfigs.delete(battle.id)
  }
  private registerWithBattle(battleId: string): void {
    if (!ConfigSystem.battleRegistry.has(battleId)) {
      ConfigSystem.battleRegistry.set(battleId, new Set())
    }
    ConfigSystem.battleRegistry.get(battleId)!.add(this)
  }

  /**
   * Get all ConfigSystem instances associated with a battle
   */
  static getBattleInstances(battleId: string): Set<ConfigSystem> | undefined {
    return ConfigSystem.battleRegistry.get(battleId)
  }

  /**
   * Clean up all ConfigSystem instances associated with a specific battle
   */
  static cleanupBattle(battleId: string): number {
    ConfigSystem.battleConfigs.delete(battleId)
    const battleInstances = ConfigSystem.battleRegistry.get(battleId)
    if (!battleInstances) {
      return 0
    }

    let cleanedCount = 0
    for (const instance of battleInstances) {
      if (!instance.getIsDestroyed()) {
        instance.destroy()
        cleanedCount++
      }
    }

    // Remove the battle from registry
    ConfigSystem.battleRegistry.delete(battleId)
    return cleanedCount
  }

  /**
   * Get battle registry for debugging
   */
  static getBattleRegistry(): Map<string, Set<ConfigSystem>> {
    return ConfigSystem.battleRegistry
  }

  /**
   * Register a config key for modifier support
   */
  get isDisposed(): boolean {
    return this.isDestroyed
  }

  hasRegisteredConfig(key: string): boolean {
    return this.baseConfigs.has(key)
  }

  registerConfig(key: string, initialValue: ConfigValue): void {
    if (this.isDestroyed) {
      this.logger.warn(`Attempted to register config '${key}' on destroyed ConfigSystem`)
      return
    }

    this.baseConfigs.set(key, new Signal(initialValue))
    this.modifiers.set(key, new Signal<ConfigModifier[]>([]))
  }

  /**
   * Register a config key with tags for modifier support
   */
  registerTaggedConfig(key: string, initialValue: ConfigValue, tags: string[]): void {
    // First register the config normally
    this.registerConfig(key, initialValue)

    // Then add tag associations
    this.addConfigTags(key, tags)
  }

  /**
   * Add tags to an existing config key
   */
  addConfigTags(key: string, tags: string[]): void {
    if (this.isDestroyed) {
      this.logger.warn(`Attempted to add tags to config '${key}' on destroyed ConfigSystem`)
      return
    }

    // Initialize config tags if not exists
    if (!this.configKeyToTags.has(key)) {
      this.configKeyToTags.set(key, new Set())
    }

    const configTags = this.configKeyToTags.get(key)!

    // Add each tag
    for (const tag of tags) {
      configTags.add(tag)

      // Update reverse mapping
      if (!this.tagToConfigKeys.has(tag)) {
        this.tagToConfigKeys.set(tag, new Set())
      }
      this.tagToConfigKeys.get(tag)!.add(key)
    }
  }

  /**
   * Remove tags from a config key
   */
  removeConfigTags(key: string, tags: string[]): void {
    if (this.isDestroyed) {
      this.logger.warn(`Attempted to remove tags from config '${key}' on destroyed ConfigSystem`)
      return
    }

    const configTags = this.configKeyToTags.get(key)
    if (!configTags) return

    for (const tag of tags) {
      configTags.delete(tag)

      // Update reverse mapping
      const tagConfigs = this.tagToConfigKeys.get(tag)
      if (tagConfigs) {
        tagConfigs.delete(key)
        if (tagConfigs.size === 0) {
          this.tagToConfigKeys.delete(tag)
        }
      }
    }

    // Clean up empty config tags
    if (configTags.size === 0) {
      this.configKeyToTags.delete(key)
    }
  }

  /**
   * Get all config keys that have a specific tag
   */
  getConfigKeysByTag(tag: string): string[] {
    const configKeys = this.tagToConfigKeys.get(tag)
    return configKeys ? Array.from(configKeys) : []
  }

  /**
   * Get all tags for a specific config key
   */
  getConfigTags(key: string): string[] {
    const tags = this.configKeyToTags.get(key)
    return tags ? Array.from(tags) : []
  }

  /**
   * Check if a config key has a specific tag
   */
  hasConfigTag(key: string, tag: string): boolean {
    const tags = this.configKeyToTags.get(key)
    return tags ? tags.has(tag) : false
  }

  /**
   * Get config value with modifier support
   */
  get(key: string, scope?: ScopeObject): ConfigValue | undefined {
    void this.scopeRevision.value
    if (this.isDestroyed) {
      this.logger.warn(`Attempted to get config '${key}' from destroyed ConfigSystem`)
      return undefined
    }

    // Check if this config has modifier support
    if (this.baseConfigs.has(key)) {
      const value = this.getScopeAwareModifiedValue(key, scope)
      this.logger.debug('value', value)
      return value
    }

    return undefined
  }

  /**
   * Get scope-aware modified value for a registered config
   */
  private getScopeAwareModifiedValue(key: string, scope?: ScopeObject): ConfigValue | undefined {
    let baseValue: ConfigValue | undefined
    const visited = new Set<ScopeObject>()

    // 1. Find the most specific base value by walking up the scope hierarchy.
    let currentScopeForBase: ScopeObject | undefined = scope
    while (currentScopeForBase) {
      if (visited.has(currentScopeForBase)) {
        this.logger.warn(`Circular scope hierarchy detected while getting base value for key '${key}', breaking loop`)
        break
      }
      visited.add(currentScopeForBase)

      const scopeConfigs = this.scopedBaseConfigs.get(currentScopeForBase)
      if (scopeConfigs && scopeConfigs.has(key)) {
        baseValue = scopeConfigs.get(key)!.value
        break // Found the most specific value, so we can stop searching.
      }
      currentScopeForBase = this.getParentScope(currentScopeForBase)
    }

    // 2. If no scoped value was found, fall back to the global base value.
    if (baseValue === undefined) {
      baseValue = this.baseConfigs.get(key)?.value
    }

    // 3. If no base value exists anywhere, the config is not set.
    if (baseValue === undefined) {
      return undefined
    }

    // 4. Get all applicable modifiers (existing logic).
    const allModifiers: ConfigModifier[] = []

    // Get global modifiers.
    const globalModifiers = this.modifiers.get(key)?.value || []
    allModifiers.push(...globalModifiers)

    // Get scope-specific modifiers by walking up the hierarchy.
    if (scope) {
      const scopeModifiers = this.getScopeSpecificModifiers(key, scope)
      allModifiers.push(...scopeModifiers)
    }

    // 5. Filter modifiers based on current scope context.
    const applicableModifiers = this.filterModifiersByScopeHierarchy(allModifiers, scope)

    // 6. Sort modifiers by priority and apply them to the determined base value.
    const sortedModifiers = applicableModifiers.sort((a, b) => b.priority - a.priority)
    return sortedModifiers.reduce((acc, modifier) => modifier.apply(acc), baseValue)
  }

  /**
   * Get scope-specific modifiers for a config key
   */
  private getScopeSpecificModifiers(key: string, scope: ScopeObject): ConfigModifier[] {
    const modifiers: ConfigModifier[] = []
    const visited = new Set<ScopeObject>() // Prevent infinite loops

    // Walk up the scope hierarchy to collect all applicable modifiers
    let currentScope: ScopeObject | undefined = scope
    while (currentScope) {
      // Prevent infinite loops by tracking visited scopes
      if (visited.has(currentScope)) {
        this.logger.warn('Circular scope hierarchy detected in getScopeSpecificModifiers, breaking loop')
        break
      }
      visited.add(currentScope)

      const scopeModifiers = this.scopedModifiers.get(currentScope)
      if (scopeModifiers && scopeModifiers.has(key)) {
        modifiers.push(...scopeModifiers.get(key)!)
      }

      // Move to parent scope
      currentScope = this.getParentScope(currentScope)
    }

    return modifiers
  }

  /**
   * Get parent scope of a scope object
   */
  private getParentScope(scope: ScopeObject): ScopeObject | undefined {
    if ('owner' in scope && scope.owner) {
      return scope.owner as ScopeObject
    } else if ('battle' in scope && scope.battle) {
      return scope.battle as ScopeObject
    }
    return undefined
  }

  /**
   * Filter modifiers based on scope hierarchy
   * Only apply modifiers that are scoped at or above the current scope level
   */
  private filterModifiersByScopeHierarchy(modifiers: ConfigModifier[], currentScope?: ScopeObject): ConfigModifier[] {
    return modifiers.filter(modifier => this.isModifierApplicableInScopeHierarchy(modifier, currentScope))
  }

  /**
   * Check if a modifier should be applied based on scope hierarchy
   */
  private isModifierApplicableInScopeHierarchy(modifier: ConfigModifier, currentScope?: ScopeObject): boolean {
    if (modifier.source && 'isActive' in modifier.source && (!modifier.source.isActive || modifier.source.isSuppressed))
      return false
    // Always apply non-phase-type modifiers for now
    if (modifier.durationType !== ConfigDurationType.phaseType) {
      return this.isModifierScopeCompatible(modifier, currentScope)
    }

    return this.isModifierScopeCompatible(modifier, currentScope) && this.isPhaseModifierApplicable(modifier)
  }

  /**
   * Check if a modifier is scope-compatible with the current scope
   * A modifier is compatible if:
   * 1. It has no source (global modifier) - always compatible
   * 2. Its source is the same as current scope
   * 3. Its source is an ancestor of current scope
   * 4. Current scope is a descendant of modifier's source scope
   */
  private isModifierScopeCompatible(modifier: ConfigModifier, currentScope?: ScopeObject): boolean {
    // No source means global modifier - always apply
    if (!modifier.source) {
      return true
    }

    // No current scope means we're in global context - only apply global modifiers
    if (!currentScope) {
      return !modifier.source
    }

    // Get the scope object associated with the modifier's source
    const modifierScope = this.getModifierSourceScope(modifier)
    if (!modifierScope) {
      // If we can't determine modifier scope, apply it (fallback to old behavior)
      return true
    }

    // Check if current scope is the same as or a descendant of modifier scope
    return this.isScopeDescendantOf(currentScope, modifierScope)
  }

  /**
   * Get the scope object associated with a modifier's source
   */
  private getModifierSourceScope(modifier: ConfigModifier): ScopeObject | undefined {
    if (!modifier.source) {
      return undefined
    }

    // If source is a MarkInstance, get its owner (Pet)
    if ('owner' in modifier.source && modifier.source.owner) {
      return modifier.source.owner as ScopeObject
    }

    // If source is a SkillInstance, get its owner (Pet)
    if ('owner' in modifier.source && modifier.source.owner) {
      return modifier.source.owner as ScopeObject
    }

    // If source is a BattlePhaseBase, we need to determine its scope
    // For now, treat phases as global scope
    if ('battle' in modifier.source && modifier.source.battle) {
      return modifier.source.battle as ScopeObject
    }

    return undefined
  }

  /**
   * Check if a scope is the same as or a descendant of another scope
   * Scope hierarchy: Battle > Player > Pet > Mark/Skill
   */
  private isScopeDescendantOf(currentScope: ScopeObject, ancestorScope: ScopeObject): boolean {
    // Same scope
    if (currentScope === ancestorScope) {
      return true
    }

    let scope: ScopeObject | undefined = currentScope
    const visited = new Set<ScopeObject>() // Prevent infinite loops

    // Walk up the scope hierarchy
    while (scope) {
      // Prevent infinite loops by tracking visited scopes
      if (visited.has(scope)) {
        this.logger.warn('Circular scope hierarchy detected, breaking loop')
        break
      }
      visited.add(scope)

      if (scope === ancestorScope) {
        return true
      }

      // If we reach Battle level and haven't found ancestor, stop
      if (scope.constructor.name === 'Battle') {
        break
      }

      // Get parent scope
      let parentScope: ScopeObject | undefined
      if ('owner' in scope && scope.owner) {
        parentScope = scope.owner as ScopeObject
      } else if ('battle' in scope && scope.battle) {
        parentScope = scope.battle as ScopeObject
      }

      // If no parent scope found, stop
      if (!parentScope) {
        break
      }

      scope = parentScope
    }

    return false
  }

  /** Release data owned by an ended scope without removing shared content definitions. */
  releaseScope(scope: ScopeObject): void {
    const modifiers = [...(this.scopedModifiers.get(scope)?.values() ?? [])].flat()
    for (const modifier of modifiers) this.modifierCleanups.get(modifier)?.()
    this.scopedModifiers.delete(scope)
    for (const value of this.scopedBaseConfigs.get(scope)?.values() ?? []) value.complete()
    this.scopedBaseConfigs.delete(scope)
    this.publishScopes()
  }

  hasScopedConfig(key: string, scope: ScopeObject): boolean {
    return this.scopedBaseConfigs.get(scope)?.has(key) ?? false
  }

  /**
   * Set config value (updates base value for modifier-enabled configs)
   */
  set(key: string, value: ConfigValue, scope?: ScopeObject): void {
    if (this.isDestroyed) {
      this.logger.warn(`Attempted to set config '${key}' on destroyed ConfigSystem`)
      return
    }

    // A config must be registered globally before a scoped or global value can be set.
    if (!this.baseConfigs.has(key)) {
      this.logger.warn(`Config key '${key}' is not registered. Please call registerConfig() first.`)
      return
    }

    if (scope) {
      // Setting a scope-specific base value.
      if (!this.scopedBaseConfigs.has(scope)) {
        this.scopedBaseConfigs.set(scope, new Map())
      }
      const scopeConfigs = this.scopedBaseConfigs.get(scope)!

      if (scopeConfigs.has(key)) {
        // Update the existing Signal for this scope.
        scopeConfigs.get(key)!.next(value)
      } else {
        // Create a new Signal for this key within this scope.
        scopeConfigs.set(key, new Signal(value))
        this.publishScopes()
      }
    } else {
      // Setting the global base value.
      this.baseConfigs.get(key)!.next(value)
    }
  }
  /**
   * Add a config modifier (legacy method - global scope)
   */
  addConfigModifier(key: string, modifier: ConfigModifier): () => void {
    return this.addScopedConfigModifier(key, modifier, undefined)
  }

  /**
   * Add a config modifier to all configs with a specific tag
   */
  addTaggedConfigModifier(
    tag: string,
    modifierType: ConfigModifierType,
    value: ConfigValue | ReactiveValue<ConfigValue>,
    priority: number = 0,
    durationType: ConfigDurationType = ConfigDurationType.instant,
    source?: MarkInstance | SkillInstance | BattlePhaseBase,
    scope?: ScopeObject,
  ): (() => void)[] {
    const configKeys = this.getConfigKeysByTag(tag)
    const cleanupFunctions: (() => void)[] = []

    for (const configKey of configKeys) {
      // Create a unique modifier ID for each config key
      const modifierId = `tagged_${tag}_${configKey}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      const modifier = new ConfigModifier(durationType, modifierId, value, modifierType, priority, source)

      const cleanup = this.addScopedConfigModifier(configKey, modifier, scope)
      cleanupFunctions.push(cleanup)
    }

    // Return a combined cleanup function
    return cleanupFunctions
  }

  /**
   * Add a config modifier to all configs with a specific tag (convenience method that returns single cleanup)
   */
  addTaggedConfigModifierSingle(
    tag: string,
    modifierType: ConfigModifierType,
    value: ConfigValue | ReactiveValue<ConfigValue>,
    priority: number = 0,
    durationType: ConfigDurationType = ConfigDurationType.instant,
    source?: MarkInstance | SkillInstance | BattlePhaseBase,
    scope?: ScopeObject,
  ): () => void {
    const cleanupFunctions = this.addTaggedConfigModifier(
      tag,
      modifierType,
      value,
      priority,
      durationType,
      source,
      scope,
    )

    // Return a single cleanup function that calls all individual cleanups
    const cleanup = () => {
      cleanupFunctions.forEach(cleanup => cleanup())
    }
    describeCleanup(cleanup, { type: 'group', cleanups: cleanupFunctions })
    return cleanup
  }

  /**
   * Add a config modifier with specific scope
   */
  addScopedConfigModifier(key: string, modifier: ConfigModifier, scope?: ScopeObject): () => void {
    if (modifier.source)
      for (const [existing, cleanup] of this.modifierCleanups) {
        if (existing.id === modifier.id && existing.source?.id === modifier.source.id) cleanup()
      }
    const rawCleanup = this.addScopedConfigModifierRaw(key, modifier, scope)
    let active = true
    const cleanup = () => {
      if (!active) return
      active = false
      deactivateCleanup(cleanup)
      this.modifierCleanups.delete(modifier)
      this.phaseBindings.delete(modifier)
      rawCleanup()
    }
    rememberModifierCleanup(this, modifier, cleanup)
    this.modifierCleanups.set(modifier, cleanup)
    return cleanup
  }

  private addScopedConfigModifierRaw(key: string, modifier: ConfigModifier, scope?: ScopeObject): () => void {
    // Ensure the config is registered
    if (!this.modifiers.has(key)) {
      throw new Error(`Config key '${key}' is not registered for modifier support. Call registerConfig() first.`)
    }

    if (scope) {
      // Add to scope-specific storage
      if (!this.scopedModifiers.has(scope)) {
        this.scopedModifiers.set(scope, new Map())
      }

      const scopeModifiers = this.scopedModifiers.get(scope)!
      if (!scopeModifiers.has(key)) {
        scopeModifiers.set(key, [])
      }

      scopeModifiers.get(key)!.push(modifier)
      this.publishScopes()

      // Return cleanup function for scoped modifier
      return () => {
        const scopeModifiers = this.scopedModifiers.get(scope)
        if (scopeModifiers && scopeModifiers.has(key)) {
          const modifierList = scopeModifiers.get(key)!
          const index = modifierList.indexOf(modifier)
          if (index > -1) {
            modifierList.splice(index, 1)
            if (modifierList.length === 0) {
              scopeModifiers.delete(key)
            }
            this.publishScopes()
          }
        }
        modifier.cleanup()
      }
    } else {
      // Fall back to global modifier storage (original implementation)
      return this.addGlobalConfigModifier(key, modifier)
    }
  }

  /**
   * Add a global config modifier (original implementation)
   */
  private addGlobalConfigModifier(key: string, modifier: ConfigModifier): () => void {
    // Check for duplicate modifiers from the same source
    if (modifier.source) {
      const sourceId = this.getSourceId(modifier.source)

      if (!this.modifiersBySource.has(sourceId)) {
        this.modifiersBySource.set(sourceId, new Map())
      }

      const sourceModifiers = this.modifiersBySource.get(sourceId)!
      if (sourceModifiers.has(key)) {
        const existingModifiers = sourceModifiers.get(key)!
        const duplicateIndex = existingModifiers.findIndex(m => m.id === modifier.id)
        if (duplicateIndex > -1) {
          // Replace existing modifier
          existingModifiers[duplicateIndex].cleanup()
          existingModifiers[duplicateIndex] = modifier
        } else {
          existingModifiers.push(modifier)
        }
      } else {
        sourceModifiers.set(key, [modifier])
      }
    }

    const currentModifiers = [...this.modifiers.get(key)!.value, modifier]
    this.modifiers.get(key)!.next(currentModifiers)

    return () => {
      // Remove from main modifiers list
      const newModifiers = this.modifiers.get(key)!.value.filter(m => m !== modifier)
      this.modifiers.get(key)!.next(newModifiers)

      // Remove from source tracking
      if (modifier.source) {
        const sourceId = this.getSourceId(modifier.source)
        const sourceModifiers = this.modifiersBySource.get(sourceId)
        if (sourceModifiers && sourceModifiers.has(key)) {
          const modifierList = sourceModifiers.get(key)!
          const index = modifierList.indexOf(modifier)
          if (index > -1) {
            modifierList.splice(index, 1)
          }

          if (modifierList.length === 0) {
            sourceModifiers.delete(key)
          }
          if (sourceModifiers.size === 0) {
            this.modifiersBySource.delete(sourceId)
          }
        }
      }

      // Cleanup modifier resources
      modifier.cleanup()
    }
  }

  /**
   * Remove all modifiers from a specific source
   */
  removeModifiersFromSource(sourceId: string): void {
    for (const [modifier, cleanup] of [...this.modifierCleanups]) {
      if (modifier.source?.id === sourceId) cleanup()
    }
  }

  /**
   * Get source ID for tracking
   */
  private getSourceId(source: MarkInstance | SkillInstance | BattlePhaseBase): string {
    return source.id
  }

  /**
   * Get all registered config keys
   */
  getRegisteredKeys(): string[] {
    return Array.from(this.baseConfigs.keys())
  }

  /**
   * Check if a config key is registered for modifier support
   */
  isRegistered(key: string): boolean {
    return this.baseConfigs.has(key)
  }

  /**
   * Phase type management methods
   */

  /**
   * Notify AttributeSystem of phase changes
   */
  private notifyAttributeSystemPhaseChange(): void {
    this.publishScopes()
    AttributeSystem.notifyPhaseChange()
  }

  /**
   * Infer phase type from phase instance
   */
  private inferPhaseType(phase: BattlePhaseBase): PhaseType {
    if (phase.phaseType) return phase.phaseType
    const className = phase.constructor.name

    // Map class names to phase types
    switch (className) {
      case 'BattleStartPhase':
      case 'BattleLoopPhase':
        return PhaseType.Battle
      case 'TurnPhase':
        return PhaseType.Turn
      case 'SkillPhase':
        return PhaseType.Skill
      case 'DamagePhase':
        return PhaseType.Damage
      case 'HealPhase':
        return PhaseType.Heal
      case 'SwitchPetPhase':
      case 'BattleSwitchPhase':
        return PhaseType.Switch
      case 'MarkPhase':
        return PhaseType.Mark
      case 'RagePhase':
        return PhaseType.Rage
      default:
        if (/^(?:Mark|AddMark|RemoveMark)/.test(className)) return PhaseType.Mark
        // Unknown custom phases use Effect unless their phaseType is explicit.
        return PhaseType.Effect
    }
  }

  /**
   * Push a phase onto the execution stack
   */
  pushPhase(phase: BattlePhaseBase): void {
    this.phaseStack.push(phase)

    // Track by phase type
    const phaseType = this.inferPhaseType(phase)
    if (!this.phaseTypeInstances.has(phaseType)) {
      this.phaseTypeInstances.set(phaseType, [])
    }
    this.phaseTypeInstances.get(phaseType)!.push(phase)

    for (const binding of this.phaseBindings.values()) {
      if (
        binding.spec.phaseType === phaseType &&
        binding.spec.scope !== PhaseScope.Any &&
        !binding.boundId &&
        !binding.excluded.has(phase.id)
      )
        binding.boundId = phase.id
    }
    // Notify synchronously: phase-sensitive attributes must change before execution.
    this.notifyAttributeSystemPhaseChange()
  }

  /**
   * Pop a phase from the execution stack and cleanup type-bound modifiers
   */
  popPhase(phase: BattlePhaseBase): void {
    const index = this.phaseStack.lastIndexOf(phase)
    if (index === -1) {
      this.logger.warn(`Phase ${phase.id} not found in phase stack`)
      return
    }

    // Remove the phase from stack
    this.phaseStack.splice(index, 1)

    // Remove from phase type tracking
    const phaseType = this.inferPhaseType(phase)
    const typeInstances = this.phaseTypeInstances.get(phaseType)
    if (typeInstances) {
      const typeIndex = typeInstances.lastIndexOf(phase)
      if (typeIndex > -1) {
        typeInstances.splice(typeIndex, 1)
      }
      if (typeInstances.length === 0) {
        this.phaseTypeInstances.delete(phaseType)
      }
    }

    // Cleanup modifiers that should be removed for this phase type
    this.cleanupPhaseTypeModifiers(phaseType, phase)

    // Notify AttributeSystem of phase change
    this.notifyAttributeSystemPhaseChange()
  }

  /**
   * Get current phase stack depth
   */
  getCurrentPhaseDepth(): number {
    return this.phaseStack.length
  }

  /**
   * Get current phase of specific type
   */
  getCurrentPhaseOfType(phaseType: PhaseType): BattlePhaseBase | undefined {
    const instances = this.phaseTypeInstances.get(phaseType)
    return instances && instances.length > 0 ? instances[instances.length - 1] : undefined
  }

  /**
   * Check if there's an active phase of specific type
   */
  hasActivePhaseOfType(phaseType: PhaseType): boolean {
    const instances = this.phaseTypeInstances.get(phaseType)
    return !!(instances && instances.length > 0)
  }

  trackPhaseModifier(modifier: object, spec: PhaseTypeSpec, cleanup: () => void): () => void {
    const active = this.phaseTypeInstances.get(spec.phaseType) ?? []
    const boundId = spec.phaseId ?? (spec.scope === PhaseScope.Current ? active.at(-1)?.id : undefined)
    this.phaseBindings.set(modifier, {
      spec: { ...spec },
      boundId,
      excluded: new Set(spec.scope === PhaseScope.Next ? active.map(p => p.id) : []),
      cleanup,
    })
    this.publishScopes()
    return () => {
      this.phaseBindings.delete(modifier)
      this.publishScopes()
    }
  }

  isPhaseModifierApplicable(modifier: object): boolean {
    const binding = this.phaseBindings.get(modifier)
    if (!binding) return false
    const active = this.phaseTypeInstances.get(binding.spec.phaseType) ?? []
    return active.some(p =>
      binding.spec.scope === PhaseScope.Any
        ? !binding.spec.phaseId || binding.spec.phaseId === p.id
        : binding.boundId === p.id,
    )
  }

  addPhaseTypeConfigModifier(key: string, modifier: ConfigModifier, spec: PhaseTypeSpec): () => void {
    return this.addScopedPhaseTypeConfigModifier(key, modifier, spec)
  }

  addScopedPhaseTypeConfigModifier(
    key: string,
    modifier: ConfigModifier,
    spec: PhaseTypeSpec,
    scope?: ScopeObject,
  ): () => void {
    if (modifier.durationType !== ConfigDurationType.phaseType)
      throw new Error('Modifier must have phaseType duration type')
    modifier.phaseTypeSpec = { ...spec }
    const cleanup = this.addScopedConfigModifier(key, modifier, scope)
    const untrack = this.trackPhaseModifier(modifier, spec, cleanup)
    return () => {
      untrack()
      cleanup()
    }
  }

  private cleanupPhaseTypeModifiers(phaseType: PhaseType, completedPhase: BattlePhaseBase): void {
    for (const [modifier, binding] of [...this.phaseBindings]) {
      if (binding.spec.phaseType !== phaseType) continue
      const matches =
        binding.spec.scope === PhaseScope.Any
          ? !binding.spec.phaseId || binding.spec.phaseId === completedPhase.id
          : binding.boundId === completedPhase.id
      if (matches) {
        this.phaseBindings.delete(modifier)
        binding.cleanup()
      }
    }
  }

  /**
   * Cleanup all resources and subscriptions
   */
  public cleanup(): void {
    if (this.isDestroyed) {
      return
    }

    for (const cleanup of [...this.modifierCleanups.values()]) cleanup()
    for (const binding of [...this.phaseBindings.values()]) binding.cleanup()
    this.phaseBindings.clear()
    // Cleanup all modifiers
    for (const [_key, modifierSubject] of this.modifiers.entries()) {
      const modifiers = modifierSubject.value
      for (const modifier of modifiers) {
        modifier.cleanup()
      }
      modifierSubject.complete()
    }

    // Cleanup all base config subjects
    for (const [_key, subject] of this.baseConfigs.entries()) {
      subject.complete()
    }

    // Cleanup all tracked subscriptions
    for (const subscription of this.allSubscriptions) {
      subscription.unsubscribe()
    }

    // Clear all maps and arrays
    this.scopedBaseConfigs.clear()
    this.scopedModifiers.clear()
    this.tagToConfigKeys.clear()
    this.configKeyToTags.clear()
    this.baseConfigs.clear()
    this.modifiers.clear()
    this.modifiersBySource.clear()
    this.phaseStack.length = 0
    this.phaseTypeInstances.clear()
    this.allSubscriptions.length = 0

    // Clear tagged configuration data
    this.tagToConfigKeys.clear()
    this.configKeyToTags.clear()

    this.logger.log(`ConfigSystem cleanup completed for battle ${this.battleId || 'unknown'}`)
  }

  /**
   * Destroy this ConfigSystem instance
   */
  public destroy(): void {
    if (this.isDestroyed) {
      return
    }

    this.cleanup()
    this.isDestroyed = true

    // Remove from battle registry if registered
    if (this.battleId) {
      const battleInstances = ConfigSystem.battleRegistry.get(this.battleId)
      if (battleInstances) {
        battleInstances.delete(this)
        if (battleInstances.size === 0) {
          ConfigSystem.battleRegistry.delete(this.battleId)
        }
      }
    }

    this.logger.log(`ConfigSystem destroyed for battle ${this.battleId || 'unknown'}`)
  }

  /**
   * Check if this instance is destroyed
   */
  public getIsDestroyed(): boolean {
    return this.isDestroyed
  }

  /**
   * Get the battle ID associated with this instance
   */
  public getBattleId(): string | undefined {
    return this.battleId
  }

  /**
   * Get global memory statistics for debugging
   */
  static getGlobalMemoryStats(): {
    totalBattles: number
    totalInstances: number
    activeInstances: number
  } {
    let totalInstances = 0
    let activeInstances = 0

    for (const [_battleId, instances] of ConfigSystem.battleRegistry) {
      totalInstances += instances.size
      for (const instance of instances) {
        if (!instance.getIsDestroyed()) {
          activeInstances++
        }
      }
    }

    return {
      totalBattles: ConfigSystem.battleRegistry.size,
      totalInstances,
      activeInstances,
    }
  }

  /**
   * Clean up all battles and their associated instances
   */
  static cleanupAllBattles(): number {
    let totalCleaned = 0

    for (const [_battleId, instances] of ConfigSystem.battleRegistry) {
      for (const instance of instances) {
        if (!instance.getIsDestroyed()) {
          instance.destroy()
          totalCleaned++
        }
      }
    }

    ConfigSystem.battleRegistry.clear()
    ConfigSystem.battleConfigs.clear()
    const logger = createChildLogger('ConfigSystem')
    logger.log(`Cleaned up ${totalCleaned} ConfigSystem instances from all battles`)
    return totalCleaned
  }
}

// A Battle's attributes query its own phase stack, never the global template.
AttributeSystem.setConfigSystemGetter((battleId?: string) =>
  battleId ? ConfigSystem.getBattleConfig(battleId) : ConfigSystem.getInstance(),
)
