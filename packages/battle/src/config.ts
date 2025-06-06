import type { baseMarkId, baseSkillId, markId, petId, playerId, skillId, speciesId } from '@arcadia-eternity/const'
import { BehaviorSubject, Subject, Observable, combineLatest } from 'rxjs'
import { map, distinctUntilChanged } from 'rxjs/operators'
import { Battle } from './battle'
import type { MarkInstance } from './mark'
import type { Pet } from './pet'
import type { Player } from './player'
import type { SkillInstance } from './skill'
import type { BattlePhaseBase } from './phase'

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
  public value!: BehaviorSubject<ConfigValue>
  private sourceSubscription?: { unsubscribe(): void }

  constructor(
    public durationType: ConfigDurationType,
    public id: string,
    initialValue: ConfigValue | Subject<ConfigValue> | Observable<ConfigValue>,
    public type: ConfigModifierType,
    public priority: number,
    public source?: MarkInstance | SkillInstance | BattlePhaseBase,
    public phaseTypeSpec?: PhaseTypeSpec, // For phaseType duration type
  ) {
    if (initialValue instanceof BehaviorSubject) {
      this.value = initialValue
    } else if (initialValue instanceof Subject) {
      let currentValue: ConfigValue | undefined
      const sub = initialValue.subscribe(val => (currentValue = val))
      sub.unsubscribe()

      if (currentValue === undefined) {
        throw new Error(`Subject passed to ConfigModifier ${this.id} has no current value`)
      }

      this.value = new BehaviorSubject<ConfigValue>(currentValue)
      this.sourceSubscription = initialValue.subscribe(val => this.value.next(val))
    } else if (initialValue instanceof Observable) {
      let hasInitialValue = false
      let currentValue: ConfigValue

      const sub = initialValue.subscribe(val => {
        currentValue = val
        if (!hasInitialValue) {
          hasInitialValue = true
          this.value = new BehaviorSubject<ConfigValue>(currentValue)
          this.sourceSubscription = initialValue.subscribe(val => this.value.next(val))
        }
      })

      if (!hasInitialValue) {
        sub.unsubscribe()
        throw new Error(`Observable passed to ConfigModifier ${this.id} did not emit an initial value synchronously`)
      }
    } else {
      this.value = new BehaviorSubject<ConfigValue>(initialValue)
    }
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
  cleanup(): void {
    if (this.sourceSubscription) {
      this.sourceSubscription.unsubscribe()
      this.sourceSubscription = undefined
    }
  }
}

/**
 * Enhanced ConfigSystem with modifier support
 * Supports dynamic config value modification through modifiers
 * Now supports non-singleton mode for battle instance isolation
 */
export class ConfigSystem {
  private static instance: ConfigSystem | null = null
  private static battleRegistry: Map<string, Set<ConfigSystem>> = new Map()

  // Base config storage
  public configMap: Map<string, ConfigValue> = new Map()
  public instanceMap: WeakMap<ScopeObject, Map<string, ConfigValue>> = new WeakMap()

  // Modifier support
  private baseConfigs: Map<string, BehaviorSubject<ConfigValue>> = new Map()
  private modifiers: Map<string, BehaviorSubject<ConfigModifier[]>> = new Map()
  private subscriptions: Map<string, Observable<ConfigValue>> = new Map()
  private modifiersBySource: Map<string, Map<string, ConfigModifier[]>> = new Map()

  // Scope-specific modifier storage
  private scopedModifiers: WeakMap<ScopeObject, Map<string, ConfigModifier[]>> = new WeakMap()

  // Phase type tracking
  private phaseStack: BattlePhaseBase[] = [] // Current phase execution stack
  private phaseTypeModifiers: Map<string, ConfigModifier[]> = new Map() // Modifiers by phase type
  private phaseTypeInstances: Map<PhaseType, BattlePhaseBase[]> = new Map() // Track instances by type

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

      // Set up AttributeSystem integration to avoid circular dependency
      // Use async import to avoid circular dependency issues
      import('./attributeSystem.js')
        .then(({ AttributeSystem }) => {
          AttributeSystem.setConfigSystemGetter(() => ConfigSystem.getInstance())
        })
        .catch(() => {
          // AttributeSystem not available, ignore
        })
    }
    return ConfigSystem.instance
  }

  /**
   * Create a new ConfigSystem instance for a battle
   * This ensures battle instances don't interfere with each other
   */
  static createInstance(battleId?: string): ConfigSystem {
    return new ConfigSystem(battleId)
  }

  /**
   * Register this instance with a battle for lifecycle management
   */
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
  registerConfig(key: string, initialValue: ConfigValue): void {
    if (this.isDestroyed) {
      console.warn(`Attempted to register config '${key}' on destroyed ConfigSystem`)
      return
    }

    this.baseConfigs.set(key, new BehaviorSubject(initialValue))
    this.modifiers.set(key, new BehaviorSubject<ConfigModifier[]>([]))

    // Create computed stream with modifier application
    const computed$ = combineLatest([this.baseConfigs.get(key)!, this.modifiers.get(key)!]).pipe(
      map(([base, modifiers]) => {
        // Sort modifiers by priority (higher priority first)
        const sortedModifiers = [...modifiers].sort((a, b) => b.priority - a.priority)
        return sortedModifiers.reduce((acc, modifier) => modifier.apply(acc), base)
      }),
      distinctUntilChanged(),
    )

    this.subscriptions.set(key, computed$)
  }

  /**
   * Get config value with modifier support
   */
  get(key: string, scope?: ScopeObject): ConfigValue | undefined {
    if (this.isDestroyed) {
      console.warn(`Attempted to get config '${key}' from destroyed ConfigSystem`)
      return undefined
    }

    // Check if this config has modifier support
    if (this.subscriptions.has(key)) {
      return this.getScopeAwareModifiedValue(key, scope)
    }

    // Fallback to original logic for non-modifier configs
    if (!scope) return this.configMap.get(key)

    let _scope: ScopeObject = scope
    while (true) {
      if (this.instanceMap.has(_scope) && this.instanceMap.get(_scope)!.has(key)) {
        return this.instanceMap.get(_scope)!.get(key)
      }

      // Handle different scope types
      if (_scope instanceof Battle) break

      let nextScope: ScopeObject | undefined
      if ('owner' in _scope && _scope.owner) {
        nextScope = _scope.owner as ScopeObject
      } else if ('battle' in _scope && _scope.battle) {
        nextScope = _scope.battle
      }

      if (!nextScope) break
      _scope = nextScope
    }
    return this.configMap.get(key)
  }

  /**
   * Get scope-aware modified value for a registered config
   */
  private getScopeAwareModifiedValue(key: string, scope?: ScopeObject): ConfigValue | undefined {
    const baseValue = this.baseConfigs.get(key)?.value
    if (baseValue === undefined) {
      return undefined
    }

    // Get all applicable modifiers
    const allModifiers: ConfigModifier[] = []

    // 1. Get global modifiers
    const globalModifiers = this.modifiers.get(key)?.value || []
    allModifiers.push(...globalModifiers)

    // 2. Get scope-specific modifiers
    if (scope) {
      const scopeModifiers = this.getScopeSpecificModifiers(key, scope)
      allModifiers.push(...scopeModifiers)
    }

    // Filter modifiers based on current scope context and scope hierarchy
    const applicableModifiers = this.filterModifiersByScopeHierarchy(allModifiers, scope)

    // Sort by priority (higher priority first)
    const sortedModifiers = applicableModifiers.sort((a: ConfigModifier, b: ConfigModifier) => b.priority - a.priority)

    // Apply modifiers to base value
    return sortedModifiers.reduce((acc: ConfigValue, modifier: ConfigModifier) => modifier.apply(acc), baseValue)
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
        console.warn('Circular scope hierarchy detected in getScopeSpecificModifiers, breaking loop')
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
    // Always apply non-phase-type modifiers for now
    if (modifier.durationType !== ConfigDurationType.phaseType) {
      return this.isModifierScopeCompatible(modifier, currentScope)
    }

    const spec = modifier.phaseTypeSpec
    if (!spec) {
      return this.isModifierScopeCompatible(modifier, currentScope)
    }

    // Check if we're currently in the right phase type
    const isInTargetPhaseType = this.hasActivePhaseOfType(spec.phaseType)
    if (!isInTargetPhaseType) {
      return false
    }

    // If specific phase ID is required, check if current phase matches
    if (spec.phaseId) {
      const currentPhase = this.getCurrentPhaseOfType(spec.phaseType)
      if (!currentPhase || currentPhase.id !== spec.phaseId) {
        return false
      }
    }

    // Check scope compatibility
    if (!this.isModifierScopeCompatible(modifier, currentScope)) {
      return false
    }

    // Check scope-specific logic
    switch (spec.scope) {
      case PhaseScope.Current:
        // Only apply if we're currently in this phase type
        return isInTargetPhaseType

      case PhaseScope.Any:
        // Apply if we're in this phase type (same as Current for now)
        return isInTargetPhaseType

      case PhaseScope.Next:
        // TODO: Implement proper "next" logic
        // For now, treat as Current
        return isInTargetPhaseType

      default:
        return true
    }
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
        console.warn('Circular scope hierarchy detected, breaking loop')
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

  /**
   * Set config value (updates base value for modifier-enabled configs)
   */
  set(key: string, value: ConfigValue, scope?: ScopeObject): void {
    // If this is a modifier-enabled config, update the base value
    if (this.baseConfigs.has(key)) {
      this.baseConfigs.get(key)!.next(value)
      return
    }

    // Fallback to original logic
    if (!scope) {
      this.configMap.set(key, value)
    } else {
      if (!this.instanceMap.has(scope)) {
        this.instanceMap.set(scope, new Map())
      }
      this.instanceMap.get(scope)!.set(key, value)
    }
  }

  /**
   * Add a config modifier (legacy method - global scope)
   */
  addConfigModifier(key: string, modifier: ConfigModifier): () => void {
    return this.addScopedConfigModifier(key, modifier, undefined)
  }

  /**
   * Add a config modifier with specific scope
   */
  addScopedConfigModifier(key: string, modifier: ConfigModifier, scope?: ScopeObject): () => void {
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
    const sourceModifiers = this.modifiersBySource.get(sourceId)
    if (!sourceModifiers) return

    for (const [configKey, modifiersToRemove] of sourceModifiers.entries()) {
      const currentModifiers = this.modifiers.get(configKey)!.value
      const filteredModifiers = currentModifiers.filter(modifier => !modifiersToRemove.includes(modifier))
      this.modifiers.get(configKey)!.next(filteredModifiers)

      // Cleanup removed modifiers
      modifiersToRemove.forEach(modifier => modifier.cleanup())
    }

    this.modifiersBySource.delete(sourceId)
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
    // Use async import to avoid circular dependency issues
    import('./attributeSystem.js')
      .then(({ AttributeSystem }) => {
        AttributeSystem.notifyPhaseChange()
      })
      .catch(() => {
        // AttributeSystem not available, ignore
      })
  }

  /**
   * Infer phase type from phase instance
   */
  private inferPhaseType(phase: BattlePhaseBase): PhaseType {
    const className = phase.constructor.name

    // Map class names to phase types
    switch (className) {
      case 'TurnPhase':
        return PhaseType.Turn
      case 'SkillPhase':
        return PhaseType.Skill
      case 'DamagePhase':
        return PhaseType.Damage
      case 'HealPhase':
        return PhaseType.Heal
      case 'SwitchPetPhase':
        return PhaseType.Switch
      case 'MarkPhase':
        return PhaseType.Mark
      case 'RagePhase':
        return PhaseType.Rage
      default:
        // Check if it contains certain keywords in the ID
        if (phase.id.includes('turn')) return PhaseType.Turn
        if (phase.id.includes('skill')) return PhaseType.Skill
        if (phase.id.includes('damage')) return PhaseType.Damage
        if (phase.id.includes('heal')) return PhaseType.Heal
        if (phase.id.includes('switch')) return PhaseType.Switch
        if (phase.id.includes('mark')) return PhaseType.Mark
        if (phase.id.includes('rage')) return PhaseType.Rage
        if (phase.id.includes('battle')) return PhaseType.Battle

        // Default to Effect for unknown types
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

    // Notify AttributeSystem of phase change
    this.notifyAttributeSystemPhaseChange()
  }

  /**
   * Pop a phase from the execution stack and cleanup type-bound modifiers
   */
  popPhase(phase: BattlePhaseBase): void {
    const index = this.phaseStack.lastIndexOf(phase)
    if (index === -1) {
      console.warn(`Phase ${phase.id} not found in phase stack`)
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

  /**
   * Add a phase-type bound config modifier (legacy method - global scope)
   */
  addPhaseTypeConfigModifier(configKey: string, modifier: ConfigModifier, phaseTypeSpec: PhaseTypeSpec): () => void {
    return this.addScopedPhaseTypeConfigModifier(configKey, modifier, phaseTypeSpec, undefined)
  }

  /**
   * Add a phase-type bound config modifier with specific scope
   */
  addScopedPhaseTypeConfigModifier(
    configKey: string,
    modifier: ConfigModifier,
    phaseTypeSpec: PhaseTypeSpec,
    scope?: ScopeObject,
  ): () => void {
    // Validate that this is a phaseType modifier
    if (modifier.durationType !== ConfigDurationType.phaseType) {
      throw new Error('Modifier must have phaseType duration type for phase type binding')
    }

    // Set the phase type spec
    modifier.phaseTypeSpec = phaseTypeSpec

    // Add to scoped modifiers
    const cleanup = this.addScopedConfigModifier(configKey, modifier, scope)

    // Track for type-based cleanup
    const typeKey = `${configKey}:${phaseTypeSpec.phaseType}:${phaseTypeSpec.scope}:${phaseTypeSpec.phaseId || 'any'}`
    if (!this.phaseTypeModifiers.has(typeKey)) {
      this.phaseTypeModifiers.set(typeKey, [])
    }
    this.phaseTypeModifiers.get(typeKey)!.push(modifier)

    return () => {
      cleanup()
      // Remove from type tracking
      const typeModifiers = this.phaseTypeModifiers.get(typeKey)
      if (typeModifiers) {
        const index = typeModifiers.indexOf(modifier)
        if (index > -1) {
          typeModifiers.splice(index, 1)
        }
        if (typeModifiers.length === 0) {
          this.phaseTypeModifiers.delete(typeKey)
        }
      }
    }
  }

  /**
   * Cleanup modifiers based on phase type completion
   */
  private cleanupPhaseTypeModifiers(phaseType: PhaseType, completedPhase: BattlePhaseBase): void {
    const modifiersToCleanup: ConfigModifier[] = []

    for (const [typeKey, modifiers] of this.phaseTypeModifiers.entries()) {
      const [_configKey, keyPhaseType, scope, phaseId] = typeKey.split(':')

      // Only process modifiers for the completed phase type
      if (keyPhaseType !== phaseType) continue

      for (const modifier of modifiers) {
        if (this.shouldCleanupPhaseTypeModifier(modifier, phaseType, scope, phaseId, completedPhase)) {
          modifiersToCleanup.push(modifier)
        }
      }
    }

    // Remove the modifiers
    for (const modifier of modifiersToCleanup) {
      this.removeSpecificModifier(modifier)
    }
  }

  /**
   * Check if a modifier should be cleaned up based on phase type completion
   */
  private shouldCleanupPhaseTypeModifier(
    modifier: ConfigModifier,
    _phaseType: PhaseType,
    scope: string,
    phaseId: string,
    completedPhase: BattlePhaseBase,
  ): boolean {
    const spec = modifier.phaseTypeSpec
    if (!spec) return false

    // If specific phase ID is specified, check if it matches
    if (phaseId !== 'any' && phaseId !== completedPhase.id) {
      return false
    }

    // Check scope matching strategy
    switch (scope) {
      case PhaseScope.Current:
        // Cleanup when the current instance of this phase type completes
        // This is the most common case - "在当前这次技能使用中"
        return true

      case PhaseScope.Any:
        // Cleanup when any instance of this phase type completes
        // This is for "在任何一次技能使用中"
        return true

      case PhaseScope.Next:
        // This is more complex - should cleanup when the NEXT instance completes
        // For now, we'll implement it the same as Current
        // TODO: Implement proper "next" logic if needed
        return true

      default:
        return false
    }
  }

  /**
   * Remove a specific modifier from all tracking structures
   */
  private removeSpecificModifier(modifier: ConfigModifier): void {
    // Find and remove from main modifiers
    for (const [_configKey, modifierSubject] of this.modifiers.entries()) {
      const currentModifiers = modifierSubject.value
      const index = currentModifiers.indexOf(modifier)
      if (index > -1) {
        const newModifiers = [...currentModifiers]
        newModifiers.splice(index, 1)
        modifierSubject.next(newModifiers)

        // Cleanup modifier resources
        modifier.cleanup()
        break
      }
    }

    // Remove from source tracking
    if (modifier.source) {
      const sourceId = this.getSourceId(modifier.source)
      const sourceModifiers = this.modifiersBySource.get(sourceId)
      if (sourceModifiers) {
        for (const [configKey, modifierList] of sourceModifiers.entries()) {
          const index = modifierList.indexOf(modifier)
          if (index > -1) {
            modifierList.splice(index, 1)
            if (modifierList.length === 0) {
              sourceModifiers.delete(configKey)
            }
            break
          }
        }
        if (sourceModifiers.size === 0) {
          this.modifiersBySource.delete(sourceId)
        }
      }
    }

    // Remove from type tracking
    for (const [typeKey, modifiers] of this.phaseTypeModifiers.entries()) {
      const index = modifiers.indexOf(modifier)
      if (index > -1) {
        modifiers.splice(index, 1)
        if (modifiers.length === 0) {
          this.phaseTypeModifiers.delete(typeKey)
        }
        break
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
    this.configMap.clear()
    this.baseConfigs.clear()
    this.modifiers.clear()
    this.subscriptions.clear()
    this.modifiersBySource.clear()
    this.phaseStack.length = 0
    this.phaseTypeModifiers.clear()
    this.phaseTypeInstances.clear()
    this.allSubscriptions.length = 0

    console.log(`ConfigSystem cleanup completed for battle ${this.battleId || 'unknown'}`)
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

    console.log(`ConfigSystem destroyed for battle ${this.battleId || 'unknown'}`)
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
    console.log(`Cleaned up ${totalCleaned} ConfigSystem instances from all battles`)
    return totalCleaned
  }
}
