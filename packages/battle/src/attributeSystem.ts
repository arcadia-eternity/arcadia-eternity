// attribute-system.ts
import { BehaviorSubject, Observable, combineLatest, Subject } from 'rxjs'
import { map, distinctUntilChanged, shareReplay } from 'rxjs/operators'
import type { StatOnBattle, StatTypeOnBattle } from '@arcadia-eternity/const'
import type { MarkInstance } from './mark'
import type { SkillInstance } from './skill'

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
        return ((current as number) * (currentValue as number)) as number as T
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
}

interface AttributeData {
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
  private baseAttributes = new Map<keyof T, BehaviorSubject<number | boolean | string>>()
  private modifiers = new Map<keyof T, BehaviorSubject<Modifier[]>>()
  private subscriptions = new Map<keyof T, Observable<number | boolean | string>>()

  // Track modifiers by source to prevent duplicates
  private modifiersBySource = new Map<string, Map<keyof T, Modifier[]>>()

  // 注册基础属性
  registerBaseAttribute(key: AttributeKey, initialValue: number | boolean | string) {
    this.baseAttributes.set(key, new BehaviorSubject(initialValue))
    this.modifiers.set(key, new BehaviorSubject<Modifier[]>([]))

    // 创建计算流 - 添加优先级排序
    const computed$ = combineLatest([this.baseAttributes.get(key)!, this.modifiers.get(key)!]).pipe(
      map(([base, modifiers]) => {
        // Sort modifiers by priority (higher priority first)
        const sortedModifiers = [...modifiers].sort((a, b) => b.priority - a.priority)
        return sortedModifiers.reduce((acc, modifier) => modifier.apply(acc), base)
      }),
      distinctUntilChanged(),
    )

    this.subscriptions.set(key, computed$)
  }

  // 获取属性流
  getAttribute$(key: AttributeKey): Observable<number | boolean | string> {
    return this.subscriptions.get(key) || new BehaviorSubject(0).asObservable()
  }

  // 获取当前属性值（同步）
  getCurrentValue(key: AttributeKey): number | boolean | string {
    const subject = this.subscriptions.get(key)
    if (subject) {
      let currentValue: number | boolean | string = 0
      subject
        .pipe(map(val => val))
        .subscribe(val => (currentValue = val))
        .unsubscribe()
      return currentValue
    }
    return 0
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
    }
  }

  // 更新基础值（如等级变化）
  updateBaseValue(key: AttributeKey, value: number | boolean | string) {
    this.baseAttributes.get(key)!.next(value)
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
  constructor() {
    super()
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
  constructor() {
    super()
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
