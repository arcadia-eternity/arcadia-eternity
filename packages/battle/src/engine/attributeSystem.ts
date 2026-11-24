import { getDamageEvaluation } from './phase/damage'
import { applyNumericModifier, type NumericModifierOperation } from './modifierMath'
import { ExecutionBudgetExceeded } from './execution/budget'
import { rememberModifierCleanup, describeCleanup, deactivateCleanup, noopCleanup } from './snapshotBindings'
// attribute-system.ts
import { Signal, ReactiveValue, derived, isReactiveValue, describeValue, isStrictValueRead } from './reactiveValue'
import { nanoid } from 'nanoid'
import type {
  StatOnBattle,
  StatTypeOnBattle,
  EntityModifierState,
  AttributeModifierInfo,
  ModifierInfo,
} from '@arcadia-eternity/const'
import type { MarkInstance } from './mark'
import type { SkillInstance } from './skill'
import { ConfigSystem, type PhaseTypeSpec } from './config'
import { createChildLogger } from './logger'

// Keep the historical helper entrypoints, backed by synchronous battle values.
export function computed<T>(computeFn: () => T, dependencies: ReactiveValue<any>[]): ReactiveValue<T> {
  return derived(computeFn, dependencies)
}
export function ref<T>(initialValue: T): Signal<T> {
  return new Signal(initialValue)
}

type AttributeKey = string
// type Modifier = <T extends number | boolean | string>(base: T) => T
export enum DurationType {
  instant = 'instant',
  binding = 'binding',
  phaseType = 'phaseType', // Bound to specific phase type completion
}

export class Modifier<T extends number | boolean | string = any> {
  public followsMarkOwner = false
  public value: ReactiveValue<T>
  private minBound = new Signal<number | undefined>(undefined)
  private maxBound = new Signal<number | undefined>(undefined)
  private extraCleanups: (() => void)[] = []
  get minValue(): number | undefined {
    return this.minBound.value
  }
  set minValue(value: number | undefined) {
    this.minBound.next(value)
  }
  get maxValue(): number | undefined {
    return this.maxBound.value
  }
  set maxValue(value: number | undefined) {
    this.maxBound.next(value)
  }
  addCleanup(cleanup: () => void): void {
    this.extraCleanups.push(cleanup)
  }

  constructor(
    public durationType: DurationType,
    public id: string,
    initialValue: T | ReactiveValue<T>,
    public type: NumericModifierOperation | 'clamp',
    public priority: number,
    public source?: MarkInstance | SkillInstance,
    minValue?: number,
    maxValue?: number,
    public phaseTypeSpec?: PhaseTypeSpec, // For phaseType duration type
  ) {
    this.minValue = minValue
    this.maxValue = maxValue
    this.value = isReactiveValue(initialValue) ? (initialValue as ReactiveValue<T>) : new Signal(initialValue as T)
  }

  // 获取当前值
  getCurrentValue(): T {
    return this.value.value
  }

  // 清理订阅
  destroy(): void {
    for (const cleanup of this.extraCleanups.splice(0)) cleanup()
  }

  apply(current: T): T {
    const value = this.getCurrentValue()
    if (this.type === 'override') return value
    if (typeof current !== 'number') return current
    if (this.type === 'clamp') {
      // Attribute bounds preserve the lower bound when a reactive range crosses.
      return Math.max(this.minValue ?? -Infinity, Math.min(this.maxValue ?? Infinity, current)) as T
    }
    if (typeof value !== 'number') return current
    return applyNumericModifier(current, this.type, value) as T
  }
}

// Helper functions for creating clamp modifiers
export const ModifierHelpers = {
  /**
   * Create a clampMax modifier that limits the maximum value
   * @param id Unique identifier for the modifier
   * @param maxValue Maximum allowed value
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   * @param durationType Duration type (instant or binding)
   */
  createClampMax: (
    id: string,
    maxValue: number | ReactiveValue<number>,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
    durationType: DurationType = DurationType.binding,
  ): Modifier<number> => {
    return new Modifier(durationType, id, maxValue, 'clampMax', priority, source)
  },

  /**
   * Create a clampMin modifier that limits the minimum value
   * @param id Unique identifier for the modifier
   * @param minValue Minimum allowed value
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   * @param durationType Duration type (instant or binding)
   */
  createClampMin: (
    id: string,
    minValue: number | ReactiveValue<number>,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
    durationType: DurationType = DurationType.binding,
  ): Modifier<number> => {
    return new Modifier(durationType, id, minValue, 'clampMin', priority, source)
  },

  /**
   * Create a clamp modifier that limits both minimum and maximum values
   * @param id Unique identifier for the modifier
   * @param minValue Minimum allowed value
   * @param maxValue Maximum allowed value
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   * @param durationType Duration type (instant or binding)
   */
  createClamp: (
    id: string,
    minValue: number,
    maxValue: number,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
    durationType: DurationType = DurationType.binding,
  ): Modifier<number> => {
    // For clamp modifier, we use 0 as the initialValue since it's not used in the clamp operation
    const modifier = new Modifier<number>(durationType, id, 0 as number, 'clamp', priority, source, minValue, maxValue)
    return modifier
  },

  /**
   * Create a reactive clamp modifier with observable min/max values
   * @param id Unique identifier for the modifier
   * @param minValue$ ReactiveValue minimum value
   * @param maxValue$ ReactiveValue maximum value
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   * @param durationType Duration type (instant or binding)
   */
  createReactiveClamp: (
    id: string,
    minValue$: ReactiveValue<number>,
    maxValue$: ReactiveValue<number>,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
    durationType: DurationType = DurationType.binding,
  ): { modifier: Modifier<number>; cleanup: () => void } => {
    // Create a custom modifier that applies both min and max clamping
    const modifier = new Modifier<number>(durationType, id, 0 as number, 'clamp', priority, source)

    // Set up reactive min/max values
    const minSub = minValue$.subscribe(val => {
      modifier.minValue = val
    })

    const maxSub = maxValue$.subscribe(val => {
      modifier.maxValue = val
    })

    const binding = { type: 'clamp', modifier, min: minValue$, max: maxValue$, active: true }
    const cleanup = () => {
      binding.active = false
      minSub.unsubscribe()
      maxSub.unsubscribe()
    }

    describeCleanup(cleanup, binding)
    modifier.addCleanup(cleanup)
    return { modifier, cleanup }
  },

  /**
   * Create a phase-type bound modifier
   * @param id Unique identifier for the modifier
   * @param value Modifier value
   * @param type Modifier type
   * @param phaseTypeSpec Phase type specification
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   */
  createPhaseTypeModifier: <T extends number | boolean | string>(
    id: string,
    value: T | ReactiveValue<T>,
    type: 'percent' | 'delta' | 'override' | 'clampMax' | 'clampMin' | 'clamp',
    phaseTypeSpec: PhaseTypeSpec,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
  ): Modifier<T> => {
    return new Modifier(DurationType.phaseType, id, value, type, priority, source, undefined, undefined, phaseTypeSpec)
  },

  /**
   * Create a phase-type bound delta modifier (most common case)
   * @param id Unique identifier for the modifier
   * @param value Delta value to add
   * @param phaseTypeSpec Phase type specification
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   */
  createPhaseTypeDelta: (
    id: string,
    value: number | ReactiveValue<number>,
    phaseTypeSpec: PhaseTypeSpec,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
  ): Modifier<number> => {
    return new Modifier(
      DurationType.phaseType,
      id,
      value,
      'delta',
      priority,
      source,
      undefined,
      undefined,
      phaseTypeSpec,
    )
  },

  /**
   * Create a phase-type bound percent modifier
   * @param id Unique identifier for the modifier
   * @param percentage Percentage value (50 = +50%, -25 = -25%, 0 = no change)
   * @param phaseTypeSpec Phase type specification
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   */
  createPhaseTypePercent: (
    id: string,
    percentage: number | ReactiveValue<number>,
    phaseTypeSpec: PhaseTypeSpec,
    priority: number = 0,
    source?: MarkInstance | SkillInstance,
  ): Modifier<number> => {
    return new Modifier(
      DurationType.phaseType,
      id,
      percentage,
      'percent',
      priority,
      source,
      undefined,
      undefined,
      phaseTypeSpec,
    )
  },
}

export interface AttributeData {
  [key: string]: number | boolean | string
}

// Strongly typed AttributeSet for Pet stats
export interface PetAttributeSet extends StatOnBattle, AttributeData {
  currentHp: number
}

// Strongly typed AttributeSet for Player rage
export interface PlayerAttributeSet extends AttributeData {
  currentRage: number
  maxRage: number
}

export class AttributeSystem<T extends AttributeData> {
  private readonly logger = createChildLogger('AttributeSystem')
  private baseAttributes = new Map<keyof T, Signal<number | boolean | string>>()
  private modifiers = new Map<keyof T, Signal<Modifier[]>>()
  private subscriptions = new Map<keyof T, ReactiveValue<number | boolean | string>>()

  // Track modifiers by source to prevent duplicates
  private modifierCleanups = new Map<Modifier, () => void>()
  private modifiersBySource = new Map<string, Map<keyof T, Modifier[]>>()

  // Track phase type modifiers for automatic cleanup
  private phaseTypeModifiers = new Map<string, Modifier[]>()

  // Phase change notification subject
  private static phaseVersion = new Signal(0)

  // Circular dependency detection and prevention
  private calculationStack = new Set<keyof T>()
  private dependencyGraph = new Map<keyof T, Set<keyof T>>()
  private fallbackValues = new Map<keyof T, number | boolean | string>()
  private maxCalculationDepth = 10
  private calculationDepthCounter = new Map<keyof T, number>()

  // Cross-object dependency tracking
  private static globalCalculationStack = new Map<string, Set<string>>()
  private objectId: string

  // Memory management
  private isDestroyed = false
  private subscriptionCleanups = new Map<keyof T, () => void>()
  private static instanceRegistry = new Set<AttributeSystem<any>>()
  private static battleRegistry = new Map<string, Set<AttributeSystem<any>>>() // battleId -> instances
  private battleId?: string // Associated battle ID

  constructor(objectName?: string) {
    // Generate unique object ID for cross-object dependency tracking
    this.objectId = objectName || `AttributeSystem_${nanoid(8)}`

    // Initialize global tracking for this object
    if (!AttributeSystem.globalCalculationStack.has(this.objectId)) {
      AttributeSystem.globalCalculationStack.set(this.objectId, new Set())
    }

    // Register this instance for battle-based lifecycle management
    AttributeSystem.instanceRegistry.add(this)
  }

  /** Semantic state only; derived streams and disposers are rebuilt after hydration. */
  public exportSnapshotState() {
    if (this.isDestroyed || this.calculationStack.size)
      throw new Error('Attribute system is not at a snapshot boundary')
    const seen = new Set<Modifier>()
    for (const modifiers of this.modifiers.values())
      for (const modifier of modifiers.value) {
        if (modifier.durationType === DurationType.phaseType)
          throw new Error('Snapshot does not support phase-bound attribute modifiers')
        if (seen.has(modifier)) throw new Error('Snapshot requires distinct modifier registrations per attribute')
        seen.add(modifier)
      }
    return {
      base: new Map([...this.baseAttributes].map(([key, value]) => [key, value.value])),
      modifiers: new Map([...this.modifiers].map(([key, value]) => [key, value.value])),
      fallback: this.fallbackValues,
      maxDepth: this.maxCalculationDepth,
      objectId: this.objectId,
      dependencies: this.dependencyGraph,
      depths: this.calculationDepthCounter,
    }
  }
  public restoreSnapshotBase(state: ReturnType<AttributeSystem<T>['exportSnapshotState']>, battleId: string): void {
    for (const key of this.baseAttributes.keys()) this.subscriptionCleanups.get(key)?.()
    this.baseAttributes.clear()
    this.modifiers.clear()
    this.subscriptions.clear()
    this.subscriptionCleanups.clear()
    for (const [key, value] of state.base) this.registerBaseAttribute(String(key), value)
    this.fallbackValues = new Map(state.fallback)
    this.maxCalculationDepth = state.maxDepth
    this.dependencyGraph = new Map(state.dependencies)
    this.calculationDepthCounter = new Map(state.depths)
    AttributeSystem.globalCalculationStack.delete(this.objectId)
    this.objectId = state.objectId
    AttributeSystem.globalCalculationStack.set(this.objectId, new Set())
    this.setBattleId(battleId)
  }
  public restoreSnapshotModifiers(state: ReturnType<AttributeSystem<T>['exportSnapshotState']>): void {
    for (const [key, modifiers] of state.modifiers)
      for (const modifier of modifiers) {
        if (modifier.durationType === DurationType.phaseType)
          throw new Error('Snapshot does not support phase-bound attribute modifiers')
        this.addModifier(String(key), modifier)
      }
  }

  private get phaseConfig() {
    return this.battleId ? ConfigSystem.getBattleConfig(this.battleId) : ConfigSystem.getInstance()
  }

  /**
   * Notify all AttributeSystem instances that phase state has changed
   */
  static notifyPhaseChange(): void {
    AttributeSystem.phaseVersion.next(AttributeSystem.phaseVersion.value + 1)
  }

  /**
   * Check if calculating a specific attribute would create a circular dependency
   */
  private wouldCreateCircularDependency(key: keyof T): boolean {
    return this.calculationStack.has(key) || this.wouldCreateCrossObjectCircularDependency(key)
  }

  /**
   * Check if calculating a specific attribute would create a cross-object circular dependency
   */
  private wouldCreateCrossObjectCircularDependency(key: keyof T): boolean {
    const globalKey = `${this.objectId}.${String(key)}`

    // Check if this attribute is already being calculated in any object
    for (const stack of AttributeSystem.globalCalculationStack.values()) {
      if (stack.has(globalKey)) {
        return true
      }
    }

    return false
  }

  /**
   * Add attribute to global calculation stack for cross-object tracking
   */
  private addToGlobalCalculationStack(key: keyof T): void {
    const globalKey = `${this.objectId}.${String(key)}`
    const stack = AttributeSystem.globalCalculationStack.get(this.objectId)
    if (stack) {
      stack.add(globalKey)
    }
  }

  /**
   * Remove attribute from global calculation stack
   */
  private removeFromGlobalCalculationStack(key: keyof T): void {
    const globalKey = `${this.objectId}.${String(key)}`
    const stack = AttributeSystem.globalCalculationStack.get(this.objectId)
    if (stack) {
      stack.delete(globalKey)
    }
  }

  /**
   * Get fallback value for an attribute in case of circular dependency
   */
  private getFallbackValue(key: keyof T): number | boolean | string {
    // Use cached fallback value if available
    if (this.fallbackValues.has(key)) {
      return this.fallbackValues.get(key)!
    }

    // Use base value as fallback
    const baseSubject = this.baseAttributes.get(key)
    if (baseSubject) {
      const fallback = baseSubject.value
      this.fallbackValues.set(key, fallback)
      return fallback
    }

    // Default fallback values by type
    const baseValue = this.baseAttributes.get(key)?.value
    if (typeof baseValue === 'number') return 0
    if (typeof baseValue === 'boolean') return false
    return ''
  }

  /**
   * Check if there's a cycle in the dependency graph using DFS
   */
  private hasCycleInDependencyGraph(): boolean {
    const visited = new Set<keyof T>()
    const recursionStack = new Set<keyof T>()

    const dfs = (node: keyof T): boolean => {
      if (recursionStack.has(node)) return true
      if (visited.has(node)) return false

      visited.add(node)
      recursionStack.add(node)

      const dependencies = this.dependencyGraph.get(node)
      if (dependencies) {
        for (const dep of dependencies) {
          if (dfs(dep)) return true
        }
      }

      recursionStack.delete(node)
      return false
    }

    for (const node of this.dependencyGraph.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) return true
      }
    }

    return false
  }

  /**
   * Reset calculation depth counter for an attribute
   */
  private resetCalculationDepth(key: keyof T): void {
    this.calculationDepthCounter.set(key, 0)
  }

  /**
   * Increment and check calculation depth to prevent infinite recursion
   */
  private checkCalculationDepth(key: keyof T): boolean {
    const current = this.calculationDepthCounter.get(key) || 0
    const newDepth = current + 1
    this.calculationDepthCounter.set(key, newDepth)

    return newDepth <= this.maxCalculationDepth
  }

  // 注册基础属性
  registerBaseAttribute(key: AttributeKey, initialValue: number | boolean | string) {
    if (this.isDestroyed) {
      throw new Error(`Cannot register attribute on destroyed AttributeSystem ${this.objectId}`)
    }

    this.baseAttributes.set(key, new Signal(initialValue))
    this.modifiers.set(key, new Signal<Modifier[]>([]))

    // Initialize fallback value
    this.fallbackValues.set(key, initialValue)

    // 创建计算流 - 添加优先级排序和phase-aware过滤以及循环依赖检测
    // Include phase change notifications to trigger recalculation
    const computed$ = derived(() => {
      void AttributeSystem.phaseVersion.value
      const base = this.baseAttributes.get(key)!.value
      const modifiers = this.modifiers.get(key)!.value
      for (const modifier of modifiers) if (modifier.value.isAvailable) void modifier.value.value
      return this.calculateAttributeValueSafely(key, base, modifiers)
    })

    describeValue(computed$, { type: 'attribute', target: this, key })
    this.subscriptions.set(key, computed$)

    // Store cleanup function for this subscription
    this.subscriptionCleanups.set(key, () => {
      // Clean up base attribute
      const baseSubject = this.baseAttributes.get(key)
      if (baseSubject) {
        baseSubject.complete()
        this.baseAttributes.delete(key)
      }

      // Clean up modifiers
      const modifierSubject = this.modifiers.get(key)
      if (modifierSubject) {
        // Clean up all modifiers for this attribute
        const currentModifiers = modifierSubject.value
        currentModifiers.forEach(modifier => modifier.destroy())
        modifierSubject.complete()
        this.modifiers.delete(key)
      }

      // Clean up subscription
      this.subscriptions.get(key)?.complete()
      this.subscriptions.delete(key)

      // Clean up fallback value
      this.fallbackValues.delete(key)
    })
  }

  /**
   * Safely calculate attribute value with circular dependency protection
   */
  private calculateAttributeValueSafely(
    key: keyof T,
    base: number | boolean | string,
    modifiers: Modifier[],
  ): number | boolean | string {
    // Check for circular dependency
    if (this.wouldCreateCircularDependency(key)) {
      if (isStrictValueRead()) throw new Error(`Circular attribute dependency: ${String(key)}`)
      this.logger.warn(`Circular dependency detected for attribute '${String(key)}', using fallback value`)
      return this.getFallbackValue(key)
    }

    // Check calculation depth to prevent infinite recursion
    if (!this.checkCalculationDepth(key)) {
      if (isStrictValueRead()) throw new Error(`Attribute calculation depth exceeded: ${String(key)}`)
      this.logger.warn(`Maximum calculation depth exceeded for attribute '${String(key)}', using fallback value`)
      this.resetCalculationDepth(key)
      return this.getFallbackValue(key)
    }

    // Add to calculation stack (both local and global)
    this.calculationStack.add(key)
    this.addToGlobalCalculationStack(key)

    try {
      // Filter modifiers based on phase context
      const applicableModifiers = this.filterModifiersByPhaseContext(modifiers)

      // Sort modifiers by priority (higher priority first)
      const sortedModifiers = [...applicableModifiers].sort((a, b) => b.priority - a.priority)

      // Apply modifiers with circular dependency protection
      const result = this.applyModifiersSafely(key, base, sortedModifiers)

      // Update fallback value with successful calculation
      this.fallbackValues.set(key, result)

      return result
    } catch (error) {
      if (error instanceof ExecutionBudgetExceeded || isStrictValueRead()) throw error
      this.logger.warn(`Error calculating attribute '${String(key)}':`, error)
      return this.getFallbackValue(key)
    } finally {
      // Remove from calculation stack (both local and global)
      this.calculationStack.delete(key)
      this.removeFromGlobalCalculationStack(key)
      // Reset calculation depth on successful completion
      this.resetCalculationDepth(key)
    }
  }

  /**
   * Apply modifiers safely with dependency tracking
   */
  private applyModifiersSafely(
    key: keyof T,
    base: number | boolean | string,
    modifiers: Modifier[],
  ): number | boolean | string {
    let result = base

    for (const modifier of modifiers) {
      try {
        result = modifier.apply(result)
      } catch (error) {
        if (error instanceof ExecutionBudgetExceeded || isStrictValueRead()) throw error
        this.logger.warn(`Error applying modifier '${modifier.id}' to attribute '${String(key)}':`, error)
        // Continue with other modifiers instead of failing completely
        continue
      }
    }

    return result
  }

  hasAttribute(key: AttributeKey): boolean {
    return !this.isDestroyed && this.baseAttributes.has(key)
  }

  // 获取属性流
  getAttribute$(key: AttributeKey): ReactiveValue<number | boolean | string> {
    if (isStrictValueRead() && !this.hasAttribute(key)) throw new Error(`Unavailable attribute: ${key}`)
    return this.subscriptions.get(key) || new Signal(0)
  }

  // 获取当前属性值（同步）
  getCurrentValue(key: AttributeKey): number | boolean | string {
    if (this.isDestroyed) {
      this.logger.warn(`Attempting to access destroyed AttributeSystem ${this.objectId}`)
      return this.getFallbackValue(key)
    }

    // Check for circular dependency in synchronous access
    if (this.wouldCreateCircularDependency(key)) {
      if (isStrictValueRead()) throw new Error(`Circular attribute dependency: ${String(key)}`)
      this.logger.warn(`Circular dependency detected in getCurrentValue for '${String(key)}', using fallback value`)
      return this.getFallbackValue(key)
    }

    const subject = this.subscriptions.get(key)
    if (subject) {
      try {
        return subject.value
      } catch (error) {
        if (error instanceof ExecutionBudgetExceeded || isStrictValueRead()) throw error
        this.logger.warn(`Error getting current value for '${String(key)}':`, error)
        return this.getFallbackValue(key)
      }
    }
    return this.getFallbackValue(key)
  }

  /**
   * Filter modifiers based on current phase context
   */
  private filterModifiersByPhaseContext(modifiers: Modifier[]): Modifier[] {
    return modifiers.filter(
      modifier =>
        modifier.value.isAvailable &&
        (!modifier.source ||
          !('isActive' in modifier.source) ||
          (modifier.source.isActive && !modifier.source.isSuppressed)) &&
        this.isModifierApplicableInCurrentPhase(modifier),
    )
  }

  /**
   * Check if a modifier should be applied in the current phase context
   */
  private isModifierApplicableInCurrentPhase(modifier: Modifier): boolean {
    // Always apply non-phase-type modifiers
    if (modifier.durationType !== DurationType.phaseType) {
      return true
    }

    const config = this.phaseConfig
    return config?.isPhaseModifierApplicable(modifier) ?? false
  }

  // 添加临时修改器（返回清理函数）
  findModifier(key: AttributeKey, id: string): Modifier | undefined {
    return this.modifiers.get(key)?.value.find(modifier => modifier.id === id)
  }

  /** Replace only the value; preserve the contribution identity and its source cleanup. */
  replaceModifierValue(key: AttributeKey, modifier: Modifier, value: ReactiveValue<number>): void {
    const list = this.modifiers.get(key)
    if (!list || !list.value.includes(modifier)) throw new Error('Modifier is not installed on this attribute')
    const previous = modifier.value
    modifier.value = value
    try {
      list.next([...list.value])
    } catch (error) {
      modifier.value = previous
      try {
        list.next([...list.value])
      } catch {
        /* Keep the original publication failure. */
      }
      throw error
    }
  }

  addModifier(key: AttributeKey, modifier: Modifier): () => void {
    if (getDamageEvaluation()) throw new Error('Cannot change attributes during damage evaluation')
    // Check for duplicate modifiers from the same source
    if (modifier.source) {
      const sourceId = modifier.source.id

      // Initialize source tracking if needed
      if (!this.modifiersBySource.has(sourceId)) {
        this.modifiersBySource.set(sourceId, new Map())
      }

      const sourceModifiers = this.modifiersBySource.get(sourceId)!

      // Check if this source already has a modifier for this attribute
      if (sourceModifiers.has(key)) {
        const existingModifiers = sourceModifiers.get(key)!

        // Check if we already have a modifier with the same type and priority
        // Note: We can't easily compare Subject values, so we compare type and priority only
        const isDuplicate = existingModifiers.some(
          existing =>
            existing.type === modifier.type && existing.priority === modifier.priority && existing.id === modifier.id, // Use ID for more precise duplicate detection
        )

        if (isDuplicate) {
          // Return a no-op cleanup function for duplicates
          return noopCleanup
        }
      }

      // Track this modifier by source
      if (!sourceModifiers.has(key)) {
        sourceModifiers.set(key, [])
      }
      sourceModifiers.get(key)!.push(modifier)
    }

    // Track phase type modifiers for automatic cleanup
    if (modifier.durationType === DurationType.phaseType && modifier.phaseTypeSpec) {
      const phaseKey = `${modifier.phaseTypeSpec.phaseType}:${modifier.phaseTypeSpec.scope}:${modifier.phaseTypeSpec.phaseId || 'any'}`
      if (!this.phaseTypeModifiers.has(phaseKey)) {
        this.phaseTypeModifiers.set(phaseKey, [])
      }
      this.phaseTypeModifiers.get(phaseKey)!.push(modifier)
    }

    let active = true
    let untrack: (() => void) | undefined
    const cleanup = () => {
      if (!active) return
      active = false
      deactivateCleanup(cleanup)
      this.modifierCleanups.delete(modifier)
      untrack?.()
      modifier.destroy()
      if (this.isDestroyed) return
      // Remove from main modifiers list
      const newModifiers = this.modifiers.get(key)!.value.filter(m => m !== modifier)
      this.modifiers.get(key)!.next(newModifiers)

      // Remove from source tracking
      if (modifier.source) {
        const sourceId = modifier.source.id
        const sourceModifiers = this.modifiersBySource.get(sourceId)
        if (sourceModifiers && sourceModifiers.has(key)) {
          const modifierList = sourceModifiers.get(key)!
          const index = modifierList.indexOf(modifier)
          if (index > -1) {
            modifierList.splice(index, 1)
          }

          // Clean up empty entries
          if (modifierList.length === 0) {
            sourceModifiers.delete(key)
          }
          if (sourceModifiers.size === 0) {
            this.modifiersBySource.delete(sourceId)
          }
        }
      }

      // Remove from phase type tracking
      if (modifier.durationType === DurationType.phaseType && modifier.phaseTypeSpec) {
        const phaseKey = `${modifier.phaseTypeSpec.phaseType}:${modifier.phaseTypeSpec.scope}:${modifier.phaseTypeSpec.phaseId || 'any'}`
        const phaseModifiers = this.phaseTypeModifiers.get(phaseKey)
        if (phaseModifiers) {
          const index = phaseModifiers.indexOf(modifier)
          if (index > -1) {
            phaseModifiers.splice(index, 1)
          }
          if (phaseModifiers.length === 0) {
            this.phaseTypeModifiers.delete(phaseKey)
          }
        }
      }
    }
    if (modifier.durationType === DurationType.phaseType && modifier.phaseTypeSpec) {
      untrack = this.phaseConfig?.trackPhaseModifier(modifier, modifier.phaseTypeSpec, cleanup)
    }
    rememberModifierCleanup(this, modifier, cleanup)
    this.modifierCleanups.set(modifier, cleanup)
    // Bind before publishing; synchronous observers must see the active phase.
    this.modifiers.get(key)!.next([...this.modifiers.get(key)!.value, modifier])
    return cleanup
  }

  /**
   * Add a phase-type bound attribute modifier
   */
  addPhaseTypeModifier(key: AttributeKey, modifier: Modifier, phaseTypeSpec: PhaseTypeSpec): () => void {
    // Validate that this is a phaseType modifier
    if (modifier.durationType !== DurationType.phaseType) {
      throw new Error('Modifier must have phaseType duration type for phase type binding')
    }

    // Set the phase type spec
    modifier.phaseTypeSpec = phaseTypeSpec

    // Add to regular modifiers
    return this.addModifier(key, modifier)
  }

  // 更新基础值（如等级变化）
  updateBaseValue(key: AttributeKey, value: number | boolean | string) {
    if (getDamageEvaluation()) throw new Error('Cannot change attributes during damage evaluation')
    this.baseAttributes.get(key)!.next(value)
    // Update fallback value when base value changes
    this.fallbackValues.set(key, value)
  }

  /**
   * Set maximum calculation depth to prevent infinite recursion
   */
  setMaxCalculationDepth(depth: number): void {
    this.maxCalculationDepth = Math.max(1, depth)
  }

  /**
   * Get current maximum calculation depth
   */
  getMaxCalculationDepth(): number {
    return this.maxCalculationDepth
  }

  /**
   * Clear all circular dependency tracking data
   */
  clearCircularDependencyTracking(): void {
    this.calculationStack.clear()
    this.dependencyGraph.clear()
    this.calculationDepthCounter.clear()
  }

  /**
   * Get current dependency graph for debugging
   */
  getDependencyGraph(): Map<keyof T, Set<keyof T>> {
    return new Map(this.dependencyGraph)
  }

  /**
   * Check if there are any circular dependencies in the current graph
   */
  hasCircularDependencies(): boolean {
    return this.hasCycleInDependencyGraph()
  }

  /**
   * Get attributes currently in calculation stack (for debugging)
   */
  getCalculationStack(): Set<keyof T> {
    return new Set(this.calculationStack)
  }

  /**
   * Manually set fallback value for an attribute
   */
  setFallbackValue(key: keyof T, value: number | boolean | string): void {
    this.fallbackValues.set(key, value)
  }

  /**
   * Get current fallback value for an attribute
   */
  getCurrentFallbackValue(key: keyof T): number | boolean | string | undefined {
    return this.fallbackValues.get(key)
  }

  /**
   * Get global calculation stack for debugging
   */
  static getGlobalCalculationStack(): Map<string, Set<string>> {
    return new Map(AttributeSystem.globalCalculationStack)
  }

  /**
   * Clear all global tracking data
   */
  static clearGlobalTracking(): void {
    AttributeSystem.globalCalculationStack.clear()
  }

  /**
   * Get this object's ID
   */
  getObjectId(): string {
    return this.objectId
  }

  /**
   * Associate this AttributeSystem with a battle
   */
  setBattleId(battleId: string): void {
    this.battleId = battleId

    // Register this instance with the battle
    if (!AttributeSystem.battleRegistry.has(battleId)) {
      AttributeSystem.battleRegistry.set(battleId, new Set())
    }
    AttributeSystem.battleRegistry.get(battleId)!.add(this)
  }

  /**
   * Get the associated battle ID
   */
  getBattleId(): string | undefined {
    return this.battleId
  }

  /**
   * Check if this instance is destroyed
   */
  isInstanceDestroyed(): boolean {
    return this.isDestroyed
  }

  /**
   * Destroy this AttributeSystem instance and clean up all resources
   */
  destroy(): void {
    if (this.isDestroyed) {
      return // Already destroyed
    }

    this.logger.debug(`Destroying AttributeSystem ${this.objectId}`)

    // Mark as destroyed
    this.isDestroyed = true

    for (const cleanup of [...this.modifierCleanups.values()]) cleanup()
    this.modifierCleanups.clear()
    // Clean up all subscriptions
    for (const [key, cleanup] of this.subscriptionCleanups) {
      try {
        cleanup()
      } catch (error) {
        this.logger.warn(`Error cleaning up attribute ${String(key)} in ${this.objectId}:`, error)
      }
    }
    this.subscriptionCleanups.clear()

    // Clean up all remaining modifiers
    for (const [_, modifierSubject] of this.modifiers) {
      const modifiers = modifierSubject.value
      modifiers.forEach(modifier => {
        try {
          modifier.destroy()
        } catch (error) {
          this.logger.warn(`Error destroying modifier ${modifier.id}:`, error)
        }
      })
      modifierSubject.complete()
    }

    // Clean up all base attributes
    for (const [_, baseSubject] of this.baseAttributes) {
      baseSubject.complete()
    }

    // Clear all maps
    this.baseAttributes.clear()
    this.modifiers.clear()
    this.subscriptions.clear()
    this.modifiersBySource.clear()
    this.phaseTypeModifiers.clear()
    this.calculationStack.clear()
    this.dependencyGraph.clear()
    this.fallbackValues.clear()
    this.calculationDepthCounter.clear()

    // Remove from global tracking
    AttributeSystem.globalCalculationStack.delete(this.objectId)

    // Remove from instance registry
    AttributeSystem.instanceRegistry.delete(this)

    // Remove from battle registry if associated with a battle
    if (this.battleId) {
      const battleInstances = AttributeSystem.battleRegistry.get(this.battleId)
      if (battleInstances) {
        battleInstances.delete(this)
        // If no more instances for this battle, remove the battle entry
        if (battleInstances.size === 0) {
          AttributeSystem.battleRegistry.delete(this.battleId)
        }
      }
    }

    this.logger.debug(`AttributeSystem ${this.objectId} destroyed successfully`)
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): {
    objectId: string
    isDestroyed: boolean
    attributeCount: number
    modifierCount: number
    subscriptionCount: number
  } {
    let totalModifiers = 0
    for (const [_, modifierSubject] of this.modifiers) {
      totalModifiers += modifierSubject.value.length
    }

    return {
      objectId: this.objectId,
      isDestroyed: this.isDestroyed,
      attributeCount: this.baseAttributes.size,
      modifierCount: totalModifiers,
      subscriptionCount: this.subscriptions.size,
    }
  }

  /**
   * Get global memory statistics
   */
  static getGlobalMemoryStats(): {
    totalInstances: number
    activeInstances: number
    destroyedInstances: number
    globalCalculationStackSize: number
    memoryUsageByInstance: ReturnType<AttributeSystem<any>['getMemoryStats']>[]
  } {
    let activeCount = 0
    let destroyedCount = 0
    const instanceStats: ReturnType<AttributeSystem<any>['getMemoryStats']>[] = []

    for (const instance of AttributeSystem.instanceRegistry) {
      const stats = instance.getMemoryStats()
      instanceStats.push(stats)

      if (stats.isDestroyed) {
        destroyedCount++
      } else {
        activeCount++
      }
    }

    return {
      totalInstances: AttributeSystem.instanceRegistry.size,
      activeInstances: activeCount,
      destroyedInstances: destroyedCount,
      globalCalculationStackSize: AttributeSystem.globalCalculationStack.size,
      memoryUsageByInstance: instanceStats,
    }
  }

  /**
   * Force cleanup of all destroyed instances
   */
  static forceCleanupDestroyedInstances(): number {
    const instancesToRemove: AttributeSystem<any>[] = []

    for (const instance of AttributeSystem.instanceRegistry) {
      if (instance.isDestroyed) {
        instancesToRemove.push(instance)
      }
    }

    instancesToRemove.forEach(instance => {
      AttributeSystem.instanceRegistry.delete(instance)
    })

    return instancesToRemove.length
  }

  /**
   * Force cleanup of all non-destroyed instances (for manual cleanup)
   * Note: This method is now primarily for debugging/testing purposes
   * since lifecycle is managed by battle instances
   */
  static forceCleanupAllInstances(): number {
    const instancesToCleanup: AttributeSystem<any>[] = []

    for (const instance of AttributeSystem.instanceRegistry) {
      if (!instance.isDestroyed) {
        instancesToCleanup.push(instance)
      }
    }

    instancesToCleanup.forEach(instance => instance.destroy())

    return instancesToCleanup.length
  }

  /**
   * Clean up all AttributeSystem instances associated with a specific battle
   */
  static cleanupBattle(battleId: string): number {
    const battleInstances = AttributeSystem.battleRegistry.get(battleId)
    if (!battleInstances) {
      return 0
    }

    let cleanedCount = 0
    for (const instance of battleInstances) {
      if (!instance.isDestroyed) {
        instance.destroy()
        cleanedCount++
      }
    }

    // Remove the battle from registry
    AttributeSystem.battleRegistry.delete(battleId)

    const logger = createChildLogger('AttributeSystem')
    logger.debug(`Cleaned up ${cleanedCount} AttributeSystem instances for battle ${battleId}`)
    return cleanedCount
  }

  /**
   * Get all AttributeSystem instances associated with a battle
   */
  static getBattleInstances(battleId: string): Set<AttributeSystem<any>> | undefined {
    return AttributeSystem.battleRegistry.get(battleId)
  }

  /**
   * Get battle registry for debugging
   */
  static getBattleRegistry(): Map<string, Set<AttributeSystem<any>>> {
    return new Map(AttributeSystem.battleRegistry)
  }

  /**
   * Clean up all battles and their associated instances
   */
  static cleanupAllBattles(): number {
    let totalCleaned = 0

    for (const [, instances] of AttributeSystem.battleRegistry) {
      for (const instance of instances) {
        if (!instance.isDestroyed) {
          instance.destroy()
          totalCleaned++
        }
      }
    }

    AttributeSystem.battleRegistry.clear()
    const logger = createChildLogger('AttributeSystem')
    logger.debug(`Cleaned up ${totalCleaned} AttributeSystem instances from all battles`)
    return totalCleaned
  }

  // 移除来自特定源的所有修改器
  removeModifiersFromSource(sourceId: string): void {
    for (const [modifier, cleanup] of [...this.modifierCleanups]) {
      if (modifier.source?.id === sourceId) cleanup()
    }
  }

  // 获取所有属性的当前值
  getAllCurrentValues(): Partial<T> {
    const result: Partial<T> = {}
    for (const key of this.baseAttributes.keys()) {
      result[key] = this.getCurrentValue(key as string) as T[keyof T]
    }
    return result
  }

  // Debug method to get modifier information
  getModifierInfo(): Record<string, { count: number; sources: string[] }> {
    const info: Record<string, { count: number; sources: string[] }> = {}

    for (const [key, modifiersSubject] of this.modifiers.entries()) {
      const modifiers = modifiersSubject.value
      const sources = modifiers
        .map(m => m.source?.id || 'unknown')
        .filter((source, index, arr) => arr.indexOf(source) === index) // unique sources

      info[key as string] = {
        count: modifiers.length,
        sources: sources,
      }
    }

    return info
  }

  // 获取详细的修改器状态信息，用于客户端显示
  getDetailedModifierState(): EntityModifierState {
    const attributes: AttributeModifierInfo[] = []
    let hasModifiers = false

    for (const [key, modifiersSubject] of this.modifiers.entries()) {
      const modifiers = modifiersSubject.value.filter(modifier => modifier.value.isAvailable)
      const baseValue = this.baseAttributes.get(key)?.value
      const currentValue = this.getCurrentValue(key as string)

      if (modifiers.length > 0) {
        hasModifiers = true
      }

      // 按优先级排序 modifier（与实际应用顺序一致）
      const sortedModifiers = [...modifiers].sort((a, b) => b.priority - a.priority)

      const modifierInfos: ModifierInfo[] = sortedModifiers.map(modifier => {
        let sourceType: 'mark' | 'skill' | 'other' = 'other'
        let sourceName: string | undefined

        if (modifier.source) {
          // 检查是否是 MarkInstance
          if ('baseId' in modifier.source) {
            sourceType = 'mark'
            sourceName = (modifier.source as any).base?.name || (modifier.source as any).id
          }
          // 检查是否是 SkillInstance
          else if ('baseSkill' in modifier.source) {
            sourceType = 'skill'
            sourceName = (modifier.source as any).baseSkill?.name || (modifier.source as any).id
          }
        }

        return {
          id: modifier.id,
          type: modifier.type,
          value: modifier.getCurrentValue(),
          priority: modifier.priority,
          sourceType,
          sourceId: modifier.source?.id,
          sourceName,
        }
      })

      attributes.push({
        attributeName: key as string,
        baseValue: baseValue ?? 0,
        currentValue: currentValue ?? 0,
        modifiers: modifierInfos,
        isModified: modifiers.length > 0,
      })
    }

    return {
      attributes,
      hasModifiers,
    }
  }
}

export interface MarkAttributes extends AttributeData {
  duration: number
  stack: number
  isActive: boolean
}

export interface LevelAttributes extends AttributeData {
  level: number
}

export interface SkillAttributes extends AttributeData {
  power: number
  accuracy: number
  rage: number
  priority: number
  appeared: boolean
}

// Pet-specific AttributeSystem with strongly typed interface
export class PetAttributeSystem extends AttributeSystem<PetAttributeSet> {
  constructor(petId?: string, battleId?: string) {
    super(petId ? `Pet_${petId}` : undefined)
    if (battleId) {
      this.setBattleId(battleId)
    }
  }

  // Initialize all pet attributes
  initializePetAttributes(baseStats: StatOnBattle, currentHp: number) {
    // Register all stat attributes
    Object.entries(baseStats).forEach(([key, value]) => {
      this.registerBaseAttribute(key, value)
    })

    // Register currentHp
    this.registerBaseAttribute('currentHp', currentHp)
  }

  // Get effective stats with stage strategy support
  getEffectiveStats(): PetAttributeSet {
    return this.getAllCurrentValues() as PetAttributeSet
  }

  // Get specific stat value
  getStat(statType: StatTypeOnBattle): number {
    return this.getCurrentValue(statType) as number
  }

  // Update current HP
  setCurrentHp(value: number) {
    this.updateBaseValue('currentHp', Math.max(0, value))
  }

  // Get current HP
  getCurrentHp(): number {
    return this.getCurrentValue('currentHp') as number
  }
}

// Player-specific AttributeSystem with strongly typed interface
export class PlayerAttributeSystem extends AttributeSystem<PlayerAttributeSet> {
  constructor(playerId?: string, battleId?: string) {
    super(playerId ? `Player_${playerId}` : undefined)
    if (battleId) {
      this.setBattleId(battleId)
    }
  }

  // Initialize player rage attributes
  initializePlayerAttributes(currentRage: number, maxRage: number) {
    this.registerBaseAttribute('currentRage', currentRage)
    this.registerBaseAttribute('maxRage', maxRage)
  }

  // Get current rage value
  getCurrentRage(): number {
    return this.getCurrentValue('currentRage') as number
  }

  // Set current rage value with clamping
  setCurrentRage(value: number) {
    const maxRage = this.getMaxRage()
    const clampedValue = Math.max(0, Math.min(value, maxRage))
    this.updateBaseValue('currentRage', clampedValue)
  }

  // Get max rage value
  getMaxRage(): number {
    return this.getCurrentValue('maxRage') as number
  }

  // Set max rage value
  setMaxRage(value: number) {
    this.updateBaseValue('maxRage', value)
  }

  // Get all current rage values
  getRageValues(): PlayerAttributeSet {
    return this.getAllCurrentValues() as PlayerAttributeSet
  }
}
