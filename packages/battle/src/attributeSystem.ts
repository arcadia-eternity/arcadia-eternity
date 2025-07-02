// attribute-system.ts
import { BehaviorSubject, Observable, combineLatest, Subject, of } from 'rxjs'
import { map, distinctUntilChanged, shareReplay, startWith, switchMap } from 'rxjs/operators'
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
import type { PhaseTypeSpec } from './config'
import { createChildLogger } from './logger'

// Computed function similar to Vue's computed
export function computed<T>(computeFn: () => T, dependencies: Observable<any>[]): Observable<T> {
  return combineLatest(dependencies).pipe(
    map(() => computeFn()),
    distinctUntilChanged(),
    shareReplay(1),
  )
}

// Helper function to create reactive refs (similar to Vue's ref)
export function ref<T>(initialValue: T): BehaviorSubject<T> {
  return new BehaviorSubject(initialValue)
}

type AttributeKey = string
// type Modifier = <T extends number | boolean | string>(base: T) => T
export enum DurationType {
  instant = 'instant',
  binding = 'binding',
  phaseType = 'phaseType', // Bound to specific phase type completion
}

export class Modifier<T extends number | boolean | string = any> {
  public value!: BehaviorSubject<T>
  private sourceSubscription?: { unsubscribe(): void }

  constructor(
    public durationType: DurationType,
    public id: string,
    initialValue: T | Subject<T> | Observable<T>,
    public type: 'percent' | 'delta' | 'override' | 'clampMax' | 'clampMin' | 'clamp',
    public priority: number,
    public source?: MarkInstance | SkillInstance,
    public minValue?: number,
    public maxValue?: number,
    public phaseTypeSpec?: PhaseTypeSpec, // For phaseType duration type
  ) {
    if (initialValue instanceof BehaviorSubject) {
      // 如果传入的是BehaviorSubject，直接使用它
      this.value = initialValue
    } else if (initialValue instanceof Subject) {
      // 如果传入的是普通Subject，需要获取当前值来创建BehaviorSubject
      let currentValue: T | undefined
      const sub = initialValue.subscribe(val => (currentValue = val))
      sub.unsubscribe()

      if (currentValue === undefined) {
        throw new Error(`Subject passed to Modifier ${this.id} has no current value`)
      }

      this.value = new BehaviorSubject<T>(currentValue)
      this.sourceSubscription = initialValue.subscribe(val => this.value.next(val))
    } else if (initialValue instanceof Observable) {
      // 如果传入的是Observable（比如computed的结果），需要先获取初始值
      let hasInitialValue = false
      let currentValue: T

      const sub = initialValue.subscribe(val => {
        currentValue = val
        if (!hasInitialValue) {
          hasInitialValue = true
          this.value = new BehaviorSubject<T>(currentValue)
          // 重新订阅以继续接收更新
          this.sourceSubscription = initialValue.subscribe(val => this.value.next(val))
        }
      })

      if (!hasInitialValue) {
        sub.unsubscribe()
        throw new Error(`Observable passed to Modifier ${this.id} did not emit an initial value synchronously`)
      }

      sub.unsubscribe()
    } else {
      // 如果传入的是普通值，创建新的BehaviorSubject
      this.value = new BehaviorSubject<T>(initialValue)
    }
  }

  // 获取当前值
  getCurrentValue(): T {
    return this.value.value
  }

  // 清理订阅
  destroy(): void {
    if (this.sourceSubscription) {
      this.sourceSubscription.unsubscribe()
      this.sourceSubscription = undefined
    }
  }

  // 统一的 apply 方法
  apply(current: T): T {
    // Get the current value from the Subject
    const currentValue = this.getCurrentValue()

    switch (this.type) {
      case 'percent':
        if (typeof currentValue !== 'number') return current
        // Convert percentage to multiplier: 50 -> 1.5, -25 -> 0.75, 0 -> 1.0
        const multiplier = 1 + (currentValue as number) / 100
        return ((current as number) * multiplier) as number as T
      case 'delta':
        if (typeof currentValue !== 'number') return current
        return ((current as number) + (currentValue as number)) as T
      case 'override':
        return currentValue
      case 'clampMax':
        if (typeof current !== 'number' || typeof currentValue !== 'number') return current
        return Math.min(current as number, currentValue as number) as T
      case 'clampMin':
        if (typeof current !== 'number' || typeof currentValue !== 'number') return current
        return Math.max(current as number, currentValue as number) as T
      case 'clamp':
        if (typeof current !== 'number') return current
        const numCurrent = current as number
        let result = numCurrent
        // Apply min clamp if minValue is provided
        if (this.minValue !== undefined) {
          result = Math.max(result, this.minValue)
        }
        // Apply max clamp if maxValue is provided
        if (this.maxValue !== undefined) {
          result = Math.min(result, this.maxValue)
        }
        return result as T
      default:
        return current
    }
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
    maxValue: number | Subject<number> | Observable<number>,
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
    minValue: number | Subject<number> | Observable<number>,
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
   * @param minValue$ Observable minimum value
   * @param maxValue$ Observable maximum value
   * @param priority Priority for modifier application (higher = applied first)
   * @param source Optional source (mark or skill instance)
   * @param durationType Duration type (instant or binding)
   */
  createReactiveClamp: (
    id: string,
    minValue$: Observable<number>,
    maxValue$: Observable<number>,
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

    const cleanup = () => {
      minSub.unsubscribe()
      maxSub.unsubscribe()
    }

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
    value: T | Subject<T> | Observable<T>,
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
    value: number | Subject<number> | Observable<number>,
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
    percentage: number | Subject<number> | Observable<number>,
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
  private baseAttributes = new Map<keyof T, BehaviorSubject<number | boolean | string>>()
  private modifiers = new Map<keyof T, BehaviorSubject<Modifier[]>>()
  private subscriptions = new Map<keyof T, Observable<number | boolean | string>>()

  // Track modifiers by source to prevent duplicates
  private modifiersBySource = new Map<string, Map<keyof T, Modifier[]>>()

  // Track phase type modifiers for automatic cleanup
  private phaseTypeModifiers = new Map<string, Modifier[]>()

  // Static reference to ConfigSystem to avoid circular dependency
  private static configSystemGetter: (() => any) | null = null

  // Instance-specific phase change notification subject
  private phaseChangeSubject = new Subject<void>()

  // Circular dependency detection and prevention
  private calculationStack = new Set<keyof T>()
  private dependencyGraph = new Map<keyof T, Set<keyof T>>()
  private fallbackValues = new Map<keyof T, number | boolean | string>()
  private maxCalculationDepth = 10
  private calculationDepthCounter = new Map<keyof T, number>()

  // Cross-object dependency tracking
  private static globalCalculationStack = new Map<string, Set<string>>()
  private static globalDependencyGraph = new Map<string, Set<string>>()
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

  /**
   * Set the ConfigSystem getter to avoid circular dependency
   */
  static setConfigSystemGetter(getter: () => any): void {
    AttributeSystem.configSystemGetter = getter
  }

  /**
   * Notify this AttributeSystem instance that phase state has changed
   */
  notifyPhaseChange(): void {
    this.phaseChangeSubject.next()
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
    for (const [objectId, stack] of AttributeSystem.globalCalculationStack) {
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
   * Track dependency between attributes for cycle detection
   */
  private trackDependency(from: keyof T, to: keyof T): void {
    if (!this.dependencyGraph.has(from)) {
      this.dependencyGraph.set(from, new Set())
    }
    this.dependencyGraph.get(from)!.add(to)
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

    this.baseAttributes.set(key, new BehaviorSubject(initialValue))
    this.modifiers.set(key, new BehaviorSubject<Modifier[]>([]))

    // Initialize fallback value
    this.fallbackValues.set(key, initialValue)

    // 创建计算流 - 添加优先级排序和phase-aware过滤以及循环依赖检测
    // Include phase change notifications to trigger recalculation
    const computed$ = combineLatest([
      this.baseAttributes.get(key)!,
      this.modifiers.get(key)!,
      this.phaseChangeSubject.pipe(
        startWith(Date.now()), // Start with initial value
        map(() => Date.now()), // Use timestamp to ensure emission
        distinctUntilChanged(),
      ),
    ]).pipe(
      // Switch to a new observable whenever modifiers change to include modifier value changes
      switchMap(([base, modifiers, _timestamp]) => {
        // Create observables for all modifier values
        const modifierValueObservables = modifiers.map(modifier =>
          modifier.value instanceof BehaviorSubject ? modifier.value.asObservable() : of(modifier.getCurrentValue()),
        )

        // If no modifiers, just return the base value
        if (modifierValueObservables.length === 0) {
          return of(this.calculateAttributeValueSafely(key, base, modifiers))
        }

        // Combine base value with all modifier values
        return combineLatest([of(base), of(modifiers), ...modifierValueObservables]).pipe(
          map(([baseValue, modifierList, ...modifierValues]) => {
            return this.calculateAttributeValueSafely(key, baseValue, modifierList)
          }),
        )
      }),
      distinctUntilChanged(),
      shareReplay(1), // Cache the latest value
    )

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
      this.logger.warn(`Circular dependency detected for attribute '${String(key)}', using fallback value`)
      return this.getFallbackValue(key)
    }

    // Check calculation depth to prevent infinite recursion
    if (!this.checkCalculationDepth(key)) {
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
        // Track dependencies for Observable-based modifiers
        if (modifier.value instanceof BehaviorSubject) {
          // For reactive modifiers, we need to track potential dependencies
          // This is a simplified approach - in practice, you might want more sophisticated tracking
          const modifierValue = modifier.getCurrentValue()

          // Apply the modifier with the current value
          result = this.applyModifierValue(result, modifier, modifierValue)
        } else {
          // For static modifiers, apply directly
          result = modifier.apply(result)
        }
      } catch (error) {
        this.logger.warn(`Error applying modifier '${modifier.id}' to attribute '${String(key)}':`, error)
        // Continue with other modifiers instead of failing completely
        continue
      }
    }

    return result
  }

  /**
   * Apply a single modifier value safely
   */
  private applyModifierValue(
    current: number | boolean | string,
    modifier: Modifier,
    modifierValue: any,
  ): number | boolean | string {
    switch (modifier.type) {
      case 'percent':
        if (typeof modifierValue !== 'number' || typeof current !== 'number') return current
        const multiplier = 1 + (modifierValue as number) / 100
        return (current as number) * multiplier
      case 'delta':
        if (typeof modifierValue !== 'number' || typeof current !== 'number') return current
        return (current as number) + (modifierValue as number)
      case 'override':
        return modifierValue
      case 'clampMax':
        if (typeof current !== 'number' || typeof modifierValue !== 'number') return current
        return Math.min(current as number, modifierValue as number)
      case 'clampMin':
        if (typeof current !== 'number' || typeof modifierValue !== 'number') return current
        return Math.max(current as number, modifierValue as number)
      case 'clamp':
        if (typeof current !== 'number') return current
        const min = modifier.minValue ?? Number.NEGATIVE_INFINITY
        const max = modifier.maxValue ?? Number.POSITIVE_INFINITY
        return Math.max(min, Math.min(max, current as number))
      default:
        return current
    }
  }

  // 获取属性流
  getAttribute$(key: AttributeKey): Observable<number | boolean | string> {
    return this.subscriptions.get(key) || new BehaviorSubject(0).asObservable()
  }

  // 获取当前属性值（同步）
  getCurrentValue(key: AttributeKey): number | boolean | string {
    if (this.isDestroyed) {
      this.logger.warn(`Attempting to access destroyed AttributeSystem ${this.objectId}`)
      return this.getFallbackValue(key)
    }

    // Check for circular dependency in synchronous access
    if (this.wouldCreateCircularDependency(key)) {
      this.logger.warn(`Circular dependency detected in getCurrentValue for '${String(key)}', using fallback value`)
      return this.getFallbackValue(key)
    }

    const subject = this.subscriptions.get(key)
    if (subject) {
      try {
        let currentValue: number | boolean | string = 0
        subject
          .pipe(map(val => val))
          .subscribe(val => (currentValue = val))
          .unsubscribe()
        return currentValue
      } catch (error) {
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
    return modifiers.filter(modifier => this.isModifierApplicableInCurrentPhase(modifier))
  }

  /**
   * Check if a modifier should be applied in the current phase context
   */
  private isModifierApplicableInCurrentPhase(modifier: Modifier): boolean {
    // Always apply non-phase-type modifiers
    if (modifier.durationType !== DurationType.phaseType) {
      return true
    }

    const spec = modifier.phaseTypeSpec
    if (!spec) {
      return true
    }

    // Get ConfigSystem instance to check current phase state
    if (!AttributeSystem.configSystemGetter) {
      // If ConfigSystem is not available, apply all modifiers
      return true
    }

    try {
      const configSystem = AttributeSystem.configSystemGetter()

      // Check if we're currently in the right phase type
      const isInTargetPhaseType = configSystem.hasActivePhaseOfType(spec.phaseType)

      if (!isInTargetPhaseType) {
        return false
      }

      // If specific phase ID is required, check if current phase matches
      if (spec.phaseId) {
        const currentPhase = configSystem.getCurrentPhaseOfType(spec.phaseType)
        if (!currentPhase || currentPhase.id !== spec.phaseId) {
          return false
        }
      }

      // Check scope-specific logic
      switch (spec.scope) {
        case 'current':
          // Only apply if we're currently in this phase type
          return isInTargetPhaseType

        case 'any':
          // Apply if we're in this phase type (same as Current for now)
          return isInTargetPhaseType

        case 'next':
          // TODO: Implement proper "next" logic
          // For now, treat as Current
          return isInTargetPhaseType

        default:
          return true
      }
    } catch (error) {
      // If ConfigSystem is not available, apply all modifiers
      return true
    }
  }

  // 添加临时修改器（返回清理函数）
  addModifier(key: AttributeKey, modifier: Modifier): () => void {
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
          return () => {}
        }
      }

      // Track this modifier by source
      if (!sourceModifiers.has(key)) {
        sourceModifiers.set(key, [])
      }
      sourceModifiers.get(key)!.push(modifier)
    }

    const currentModifiers = [...this.modifiers.get(key)!.value, modifier]
    this.modifiers.get(key)!.next(currentModifiers)

    // Track phase type modifiers for automatic cleanup
    if (modifier.durationType === DurationType.phaseType && modifier.phaseTypeSpec) {
      const phaseKey = `${modifier.phaseTypeSpec.phaseType}:${modifier.phaseTypeSpec.scope}:${modifier.phaseTypeSpec.phaseId || 'any'}`
      if (!this.phaseTypeModifiers.has(phaseKey)) {
        this.phaseTypeModifiers.set(phaseKey, [])
      }
      this.phaseTypeModifiers.get(phaseKey)!.push(modifier)
    }

    return () => {
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
   * Track cross-object dependency for debugging
   */
  trackCrossObjectDependency(fromObjectId: string, fromKey: string, toObjectId: string, toKey: string): void {
    const fromGlobalKey = `${fromObjectId}.${fromKey}`
    const toGlobalKey = `${toObjectId}.${toKey}`

    if (!AttributeSystem.globalDependencyGraph.has(fromGlobalKey)) {
      AttributeSystem.globalDependencyGraph.set(fromGlobalKey, new Set())
    }
    AttributeSystem.globalDependencyGraph.get(fromGlobalKey)!.add(toGlobalKey)
  }

  /**
   * Check if there are cross-object circular dependencies
   */
  static hasGlobalCircularDependencies(): boolean {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const dfs = (node: string): boolean => {
      if (recursionStack.has(node)) return true
      if (visited.has(node)) return false

      visited.add(node)
      recursionStack.add(node)

      const dependencies = AttributeSystem.globalDependencyGraph.get(node)
      if (dependencies) {
        for (const dep of dependencies) {
          if (dfs(dep)) return true
        }
      }

      recursionStack.delete(node)
      return false
    }

    for (const node of AttributeSystem.globalDependencyGraph.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) return true
      }
    }

    return false
  }

  /**
   * Get global calculation stack for debugging
   */
  static getGlobalCalculationStack(): Map<string, Set<string>> {
    return new Map(AttributeSystem.globalCalculationStack)
  }

  /**
   * Get global dependency graph for debugging
   */
  static getGlobalDependencyGraph(): Map<string, Set<string>> {
    return new Map(AttributeSystem.globalDependencyGraph)
  }

  /**
   * Clear all global tracking data
   */
  static clearGlobalTracking(): void {
    AttributeSystem.globalCalculationStack.clear()
    AttributeSystem.globalDependencyGraph.clear()
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

    // Clean up phase change subject
    this.phaseChangeSubject.complete()

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

    // Clean up global dependency graph entries for this object
    const keysToDelete: string[] = []
    for (const [key, _] of AttributeSystem.globalDependencyGraph) {
      if (key.startsWith(`${this.objectId}.`)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach(key => AttributeSystem.globalDependencyGraph.delete(key))

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
    globalDependencyGraphSize: number
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
      globalDependencyGraphSize: AttributeSystem.globalDependencyGraph.size,
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
    const sourceModifiers = this.modifiersBySource.get(sourceId)
    if (!sourceModifiers) return

    // Remove modifiers from each attribute
    for (const [attributeKey, modifiersToRemove] of sourceModifiers.entries()) {
      const currentModifiers = this.modifiers.get(attributeKey)!.value
      const filteredModifiers = currentModifiers.filter(modifier => !modifiersToRemove.includes(modifier))
      this.modifiers.get(attributeKey)!.next(filteredModifiers)
    }

    // Clean up source tracking
    this.modifiersBySource.delete(sourceId)
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
      const modifiers = modifiersSubject.value
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

// Composable AttributeSet fragments
export interface BaseMarkAttributes extends AttributeData {
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

export interface RageAttributes extends AttributeData {
  currentRage: number
  maxRage: number
}

// Composed AttributeSets using intersection types
export type MarkAttributeSet = BaseMarkAttributes
export type StatLevelMarkAttributeSet = BaseMarkAttributes & LevelAttributes
export type SkillAttributeSet = SkillAttributes
export type RageAttributeSet = RageAttributes

// Legacy aliases for backward compatibility
export interface BaseMarkAttributeSet extends BaseMarkAttributes {}

// Attribute initializer functions for composable setup
export const AttributeInitializers = {
  // Base mark attributes
  baseMarkAttributes: (system: AttributeSystem<any>, duration: number, stack: number, isActive: boolean = true) => {
    system.registerBaseAttribute('duration', duration)
    system.registerBaseAttribute('stack', stack)
    system.registerBaseAttribute('isActive', isActive)
  },

  // Level attributes
  levelAttributes: (system: AttributeSystem<any>, level: number = 0) => {
    system.registerBaseAttribute('level', level)
  },

  // Skill attributes
  skillAttributes: (
    system: AttributeSystem<any>,
    power: number,
    accuracy: number,
    rage: number,
    priority: number,
    appeared: boolean = false,
  ) => {
    system.registerBaseAttribute('power', power)
    system.registerBaseAttribute('accuracy', accuracy)
    system.registerBaseAttribute('rage', rage)
    system.registerBaseAttribute('priority', priority)
    system.registerBaseAttribute('appeared', appeared)
  },

  // Rage attributes
  rageAttributes: (system: AttributeSystem<any>, currentRage: number, maxRage: number) => {
    system.registerBaseAttribute('currentRage', currentRage)
    system.registerBaseAttribute('maxRage', maxRage)
  },
}

// Attribute accessor functions for composable access
export const AttributeAccessors = {
  // Base mark accessors
  baseMarkAccessors: <T extends BaseMarkAttributes>(system: AttributeSystem<T>) => ({
    getDuration: () => system.getCurrentValue('duration') as number,
    setDuration: (value: number) => system.updateBaseValue('duration', value),
    getStack: () => system.getCurrentValue('stack') as number,
    setStack: (value: number) => system.updateBaseValue('stack', Math.max(0, value)),
    getIsActive: () => system.getCurrentValue('isActive') as boolean,
    setIsActive: (value: boolean) => system.updateBaseValue('isActive', value),
  }),

  // Level accessors
  levelAccessors: <T extends LevelAttributes>(system: AttributeSystem<T>) => ({
    getLevel: () => system.getCurrentValue('level') as number,
    setLevel: (value: number) => system.updateBaseValue('level', value),
  }),

  // Skill accessors
  skillAccessors: <T extends SkillAttributes>(system: AttributeSystem<T>) => ({
    getPower: () => system.getCurrentValue('power') as number,
    setPower: (value: number) => system.updateBaseValue('power', value),
    getAccuracy: () => system.getCurrentValue('accuracy') as number,
    setAccuracy: (value: number) => system.updateBaseValue('accuracy', value),
    getRage: () => system.getCurrentValue('rage') as number,
    setRage: (value: number) => system.updateBaseValue('rage', value),
    getPriority: () => system.getCurrentValue('priority') as number,
    setPriority: (value: number) => system.updateBaseValue('priority', value),
    getAppeared: () => system.getCurrentValue('appeared') as boolean,
    setAppeared: (value: boolean) => system.updateBaseValue('appeared', value),
  }),

  // Rage accessors
  rageAccessors: <T extends RageAttributes>(system: AttributeSystem<T>) => ({
    getCurrentRage: () => system.getCurrentValue('currentRage') as number,
    setCurrentRage: (value: number) => system.updateBaseValue('currentRage', value),
    getMaxRage: () => system.getCurrentValue('maxRage') as number,
    setMaxRage: (value: number) => system.updateBaseValue('maxRage', value),
  }),
}

// Type definitions for accessor objects
export interface BaseMarkAccessors {
  getDuration: () => number
  setDuration: (value: number) => void
  getStack: () => number
  setStack: (value: number) => void
  getIsActive: () => boolean
  setIsActive: (value: boolean) => void
}

export interface LevelAccessors {
  getLevel: () => number
  setLevel: (value: number) => void
}

export interface SkillAccessors {
  getPower: () => number
  setPower: (value: number) => void
  getAccuracy: () => number
  setAccuracy: (value: number) => void
  getRage: () => number
  setRage: (value: number) => void
  getPriority: () => number
  setPriority: (value: number) => void
  getAppeared: () => boolean
  setAppeared: (value: boolean) => void
}

export interface RageAccessors {
  getCurrentRage: () => number
  setCurrentRage: (value: number) => void
  getMaxRage: () => number
  setMaxRage: (value: number) => void
}

// Composable AttributeSystem class that can be configured with different attribute sets
export class ComposableAttributeSystem<T extends AttributeData> extends AttributeSystem<T> {
  private accessors: Partial<BaseMarkAccessors & LevelAccessors & SkillAccessors & RageAccessors> = {}

  constructor() {
    super()
  }

  // Add base mark attributes and accessors
  withBaseMarkAttributes<U extends T & BaseMarkAttributes>(
    this: ComposableAttributeSystem<U>,
    duration: number,
    stack: number,
    isActive: boolean = true,
  ): ComposableAttributeSystem<U> & { getAccessors(): BaseMarkAccessors } {
    AttributeInitializers.baseMarkAttributes(this, duration, stack, isActive)
    Object.assign(this.accessors, AttributeAccessors.baseMarkAccessors(this))
    return this as any
  }

  // Add level attributes and accessors
  withLevelAttributes<U extends T & LevelAttributes>(
    this: ComposableAttributeSystem<U>,
    level: number = 0,
  ): ComposableAttributeSystem<U> & { getAccessors(): LevelAccessors } {
    AttributeInitializers.levelAttributes(this, level)
    Object.assign(this.accessors, AttributeAccessors.levelAccessors(this))
    return this as any
  }

  // Add skill attributes and accessors
  withSkillAttributes<U extends T & SkillAttributes>(
    this: ComposableAttributeSystem<U>,
    power: number,
    accuracy: number,
    rage: number,
    priority: number,
    appeared: boolean = false,
  ): ComposableAttributeSystem<U> & { getAccessors(): SkillAccessors } {
    AttributeInitializers.skillAttributes(this, power, accuracy, rage, priority, appeared)
    Object.assign(this.accessors, AttributeAccessors.skillAccessors(this))
    return this as any
  }

  // Add rage attributes and accessors
  withRageAttributes<U extends T & RageAttributes>(
    this: ComposableAttributeSystem<U>,
    currentRage: number,
    maxRage: number,
  ): ComposableAttributeSystem<U> & { getAccessors(): RageAccessors } {
    AttributeInitializers.rageAttributes(this, currentRage, maxRage)
    Object.assign(this.accessors, AttributeAccessors.rageAccessors(this))
    return this as any
  }

  // Get all accessors with proper typing
  getAccessors(): Partial<BaseMarkAccessors & LevelAccessors & SkillAccessors & RageAccessors> {
    return this.accessors
  }
}

// Factory functions for creating specific AttributeSystem configurations
export const createMarkAttributeSystem = (
  duration: number,
  stack: number,
  isActive: boolean = true,
): ComposableAttributeSystem<MarkAttributeSet> & {
  getAccessors(): BaseMarkAccessors
} => {
  return new ComposableAttributeSystem<MarkAttributeSet>().withBaseMarkAttributes(duration, stack, isActive) as any
}

export const createStatLevelMarkAttributeSystem = (
  duration: number,
  stack: number,
  isActive: boolean = true,
  level: number = 0,
): ComposableAttributeSystem<StatLevelMarkAttributeSet> & {
  getAccessors(): BaseMarkAccessors & LevelAccessors
} => {
  return new ComposableAttributeSystem<StatLevelMarkAttributeSet>()
    .withBaseMarkAttributes(duration, stack, isActive)
    .withLevelAttributes(level) as any
}

export const createSkillAttributeSystem = (
  power: number,
  accuracy: number,
  rage: number,
  priority: number,
  appeared: boolean = false,
): ComposableAttributeSystem<SkillAttributeSet> & {
  getAccessors(): SkillAccessors
} => {
  return new ComposableAttributeSystem<SkillAttributeSet>().withSkillAttributes(
    power,
    accuracy,
    rage,
    priority,
    appeared,
  ) as any
}

export const createRageAttributeSystem = (
  currentRage: number,
  maxRage: number,
): ComposableAttributeSystem<RageAttributeSet> & {
  getAccessors(): RageAccessors
} => {
  return new ComposableAttributeSystem<RageAttributeSet>().withRageAttributes(currentRage, maxRage) as any
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

// Legacy classes for backward compatibility
export class MarkAttributeSystem extends ComposableAttributeSystem<MarkAttributeSet> {
  private markAccessors!: BaseMarkAccessors

  constructor() {
    super()
  }

  // Legacy method for backward compatibility
  initializeMarkAttributes(duration: number, stack: number, isActive: boolean = true) {
    this.withBaseMarkAttributes(duration, stack, isActive)
    this.markAccessors = this.getAccessors() as BaseMarkAccessors
  }

  // Legacy accessors for backward compatibility
  getDuration(): number {
    return this.markAccessors.getDuration()
  }

  setDuration(value: number) {
    this.markAccessors.setDuration(value)
  }

  getStack(): number {
    return this.markAccessors.getStack()
  }

  setStack(value: number) {
    this.markAccessors.setStack(value)
  }

  getIsActive(): boolean {
    return this.markAccessors.getIsActive()
  }

  setIsActive(value: boolean) {
    this.markAccessors.setIsActive(value)
  }
}

// Legacy Skill-specific AttributeSystem for backward compatibility
export class SkillAttributeSystem extends ComposableAttributeSystem<SkillAttributeSet> {
  private skillAccessors!: SkillAccessors

  constructor() {
    super()
  }

  // Legacy method for backward compatibility
  initializeSkillAttributes(
    power: number,
    accuracy: number,
    rage: number,
    priority: number,
    appeared: boolean = false,
  ) {
    this.withSkillAttributes(power, accuracy, rage, priority, appeared)
    this.skillAccessors = this.getAccessors() as SkillAccessors
  }

  // Legacy accessors for backward compatibility
  getPower(): number {
    return this.skillAccessors.getPower()
  }

  setPower(value: number) {
    this.skillAccessors.setPower(value)
  }

  getAccuracy(): number {
    return this.skillAccessors.getAccuracy()
  }

  setAccuracy(value: number) {
    this.skillAccessors.setAccuracy(value)
  }

  getRage(): number {
    return this.skillAccessors.getRage()
  }

  setRage(value: number) {
    this.skillAccessors.setRage(value)
  }

  getPriority(): number {
    return this.skillAccessors.getPriority()
  }

  setPriority(value: number) {
    this.skillAccessors.setPriority(value)
  }

  getAppeared(): boolean {
    return this.skillAccessors.getAppeared()
  }

  setAppeared(value: boolean) {
    this.skillAccessors.setAppeared(value)
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
