import {
  EffectTrigger,
  StackStrategy,
  StatTypeWithoutHp,
  type Events,
  type MarkConfig,
  type MarkMessage,
  type baseMarkId,
  type markId,
} from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'

import type { Emitter } from 'mitt'
import { Observable } from 'rxjs'
import {
  DurationType,
  MarkAttributeSystem,
  Modifier,
  computed,
  createStatLevelMarkAttributeSystem,
  type BaseMarkAccessors,
  type LevelAccessors,
} from './attributeSystem'
import { Battle } from './battle'
import { AddMarkContext, DamageContext, EffectContext, SwitchPetContext } from './context'
import { Effect, type EffectContainer, TemporaryEffect } from './effect'
import { type Instance, type MarkOwner, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import { ConsumeStackPhase } from './phases/consumeStack'

export interface IBaseMark extends Prototype {
  createInstance(...arg: any[]): MarkInstance
}

export class BaseMark implements Prototype, IBaseMark {
  constructor(
    public readonly id: baseMarkId,
    public readonly effects: Effect<EffectTrigger>[],
    public readonly config: Readonly<MarkConfig> = {
      duration: 3,
      persistent: true,
      maxStacks: 1,
      stackable: false,
      stackStrategy: StackStrategy.extend,
      destroyable: true,
      isShield: false,
      keepOnSwitchOut: false,
      transferOnSwitch: false,
      inheritOnFaint: false,
      mutexGroup: undefined,
    },
    public readonly tags: string[] = [],
  ) {}

  createInstance(overrides?: {
    duration?: number
    stack?: number
    config?: Partial<BaseMark['config']>
    name?: string
    tags?: string[]
    effects?: Effect<EffectTrigger>[]
  }) {
    return new MarkInstanceImpl(this, overrides)
  }
}

export interface MarkInstance extends EffectContainer, OwnedEntity<Pet | Battle | null>, Instance {
  owner: Pet | Battle | null

  readonly id: markId
  readonly effects: Effect<EffectTrigger>[]
  config: Partial<MarkConfig>
  readonly tags: string[]

  readonly base: BaseMark
  readonly attributeSystem: MarkAttributeSystem

  // Compatibility properties
  _stack: number
  duration: number
  isActive: boolean

  get stack(): number
  set stack(value: number)
  get baseId(): baseMarkId
  setOwner(owner: MarkOwner, emitter: Emitter<Events>): void
  attachTo(target: MarkOwner): void
  detach(): void
  addStack(value: number): void
  consumeStack(context: EffectContext<EffectTrigger> | DamageContext, amount: number): number
  get isStackable(): boolean

  addTemporaryEffect(effect: Effect<EffectTrigger>, phaseId: string): void
  clearTemporaryEffects(phaseId: string): void

  cleanupAttributeModifiers(): void
  transfer(context: EffectContext<EffectTrigger> | SwitchPetContext, target: Battle | Pet): void
  toMessage(): MarkMessage
}

export class MarkInstanceImpl implements MarkInstance {
  public owner: Battle | Pet | null = null

  public readonly id: markId
  private _effects: Effect<EffectTrigger>[]
  private temporaryEffects: TemporaryEffect[] = []
  public config: Partial<MarkConfig> = { destroyable: true }
  public readonly tags: string[] = []

  public emitter?: Emitter<Events>

  get effects(): Effect<EffectTrigger>[] {
    return [...this._effects, ...this.temporaryEffects.map(te => te.effect)]
  }

  // Attribute system for managing mark parameters
  public readonly attributeSystem: MarkAttributeSystem

  // Store cleanup functions for attribute modifiers
  private attributeModifierCleanups: (() => void)[] = []

  constructor(
    public readonly base: BaseMark,
    overrides?: {
      duration?: number
      stack?: number
      config?: Partial<BaseMark['config']>
      tags?: string[]
      effects?: Effect<EffectTrigger>[]
    },
    public readonly creator?: Instance,
  ) {
    this.id = nanoid() as markId
    const mergedConfig = {
      ...base.config,
      ...overrides?.config,
      // 确保枚举类型有默认值
      stackStrategy: overrides?.config?.stackStrategy ?? base.config.stackStrategy ?? StackStrategy.stack,
    }

    // Initialize attribute system with mark ID (battleId will be set later in setOwner)
    this.attributeSystem = new MarkAttributeSystem()

    // Initialize attribute system with mark parameters
    const duration = overrides?.duration ?? mergedConfig.duration ?? base.config.duration ?? 3
    const finalDuration = mergedConfig.persistent ? -1 : duration
    const stack = overrides?.stack ?? base.config.maxStacks ?? 1

    this.attributeSystem.initializeMarkAttributes(finalDuration, stack, true)

    this.config = mergedConfig
    this.tags = [...base.tags, ...(overrides?.tags || [])]
    this._effects = [...base.effects, ...(overrides?.effects || [])]

    this.config.isShield = mergedConfig.isShield ?? false
  }

  addTemporaryEffect(effect: Effect<EffectTrigger>, phaseId: string): void {
    this.temporaryEffects.push(new TemporaryEffect(effect, phaseId))
  }

  clearTemporaryEffects(phaseId: string): void {
    this.temporaryEffects = this.temporaryEffects.filter(tempEffect => tempEffect.phaseId !== phaseId)
  }

  // Compatibility properties using AttributeSystem
  get _stack(): number {
    return this.attributeSystem.getStack()
  }

  set _stack(value: number) {
    this.attributeSystem.setStack(value)
  }

  get stack(): number {
    return this.attributeSystem.getStack()
  }

  set stack(value: number) {
    this.attributeSystem.setStack(value)
  }

  get duration(): number {
    return this.attributeSystem.getDuration()
  }

  set duration(value: number) {
    this.attributeSystem.setDuration(value)
  }

  get isActive(): boolean {
    return this.attributeSystem.getIsActive()
  }

  set isActive(value: boolean) {
    this.attributeSystem.setIsActive(value)
  }

  get baseId(): baseMarkId {
    return this.base.id
  }

  OnMarkCreated(target: Battle | Pet, context: AddMarkContext) {
    this.setOwner(target, target.emitter!)
    context.battle.applyEffects(context, EffectTrigger.OnMarkCreated, this)
    context.battle.applyEffects(context, EffectTrigger.OnAnyMarkAdded)

    this.attachTo(target)
    target.marks.push(this)
    // Note: dirty flag removed, attribute system handles recalculation automatically
  }

  setOwner(owner: Battle | Pet, emitter: Emitter<Events>): void {
    this.owner = owner
    this.emitter = emitter

    // Set battleId for attribute system
    if (owner instanceof Pet && owner.owner?.battle) {
      this.attributeSystem.setBattleId(owner.owner.battle.id)
    } else if (owner instanceof Battle) {
      this.attributeSystem.setBattleId(owner.id)
    }
  }

  attachTo(target: Battle | Pet) {
    this.owner = target
  }

  detach() {
    if (this.owner) {
      this.owner.marks = this.owner.marks.filter(m => m !== this)
    }
    this.owner = null
  }

  addStack(value: number) {
    this.stack = Math.min(this.config.maxStacks ?? Infinity, this.stack + value)
  }

  consumeStack(context: EffectContext<EffectTrigger> | DamageContext, amount: number): number {
    // Use ConsumeStackPhase for unified stack consumption
    const consumePhase = new ConsumeStackPhase(context.battle, context, this, amount)
    context.battle.phaseManager.registerPhase(consumePhase)
    const result = context.battle.phaseManager.executePhase(consumePhase.id)

    if (result.success && consumePhase.context) {
      return consumePhase.context.actualAmount
    }
    return 0
  }

  get isStackable() {
    if (this.config.stackable !== undefined) return this.config.stackable
    return false
  }

  // Add an attribute modifier cleanup function
  addAttributeModifierCleanup(cleanup: () => void) {
    this.attributeModifierCleanups.push(cleanup)
  }

  // Clean up all attribute modifiers
  public cleanupAttributeModifiers() {
    // Use individual cleanup functions first
    this.attributeModifierCleanups.forEach(cleanup => cleanup())
    this.attributeModifierCleanups = []

    // Also use the bulk removal method as a safety net
    if (this.owner instanceof Pet) {
      this.owner.attributeSystem.removeModifiersFromSource(this.id)
    }
  }

  public transfer(context: EffectContext<EffectTrigger> | SwitchPetContext, target: Battle | Pet) {
    this.attachTo(target)
    target.marks.push(this)
    // Mark cleanup will be handled by the phase system at appropriate times
    // No immediate cleanup needed here as the mark is just being transferred
  }

  toMessage(): MarkMessage {
    return {
      id: this.id,
      baseId: this.base.id,
      stack: this.stack,
      duration: this.duration,
      isActive: this.isActive,
      config: this.config,
    }
  }
}

export class BaseStatLevelMark extends BaseMark {
  constructor(
    public readonly statType: StatTypeWithoutHp,
    public initialLevel: number,
    id: baseMarkId,
  ) {
    super(
      id,
      [],
      {
        duration: -1,
        persistent: true,
        maxStacks: 6,
        stackStrategy: StackStrategy.stack,
        destroyable: true,
        stackable: true,
        isShield: false,
        keepOnSwitchOut: true,
        transferOnSwitch: false,
        inheritOnFaint: false,
      },
      ['statStage'],
    )
  }

  createInstance(): StatLevelMarkInstanceImpl {
    const instance = new StatLevelMarkInstanceImpl(this)
    instance.level = this.initialLevel
    return instance
  }
}

export class StatLevelMarkInstanceImpl extends MarkInstanceImpl implements MarkInstance {
  //一般是Pet，我知道你们可能会尝试加到奇怪的地方。
  declare public owner: Pet | null
  private modifierCleanupFn?: () => void

  // 使用组合的方式管理attributeSystem，专门用于StatLevel相关的属性
  private statLevelAttributeSystem: ReturnType<typeof createStatLevelMarkAttributeSystem>
  private levelAccessors: BaseMarkAccessors & LevelAccessors

  // 使用computed创建自动计算的stage multiplier，基于attributeSystem的level
  private stageMultiplier$: Observable<number>

  constructor(public readonly base: BaseStatLevelMark) {
    super(base)

    // 创建专门的attributeSystem实例用于管理StatLevel属性
    // 使用父类的属性值，避免循环依赖
    this.statLevelAttributeSystem = createStatLevelMarkAttributeSystem(
      super.duration, // 使用父类的duration
      super.stack, // 使用父类的stack
      super.isActive, // 使用父类的isActive
      base.initialLevel,
    )

    // Cache the accessors for type safety
    this.levelAccessors = this.statLevelAttributeSystem.getAccessors() as BaseMarkAccessors & LevelAccessors

    // 创建基于attributeSystem level的computed Observable
    this.stageMultiplier$ = computed(
      () => this.getStageMultiplier(this.levelAccessors.getLevel()),
      [this.statLevelAttributeSystem.getAttribute$('level')],
    )
  }

  // level的getter和setter，操作attributeSystem
  get level(): number {
    return this.levelAccessors.getLevel()
  }

  set level(value: number) {
    this.levelAccessors.setLevel(value)
  }

  get statType() {
    return this.base.statType
  }

  get stack() {
    return Math.abs(this.level)
  }

  override OnMarkCreated(target: Battle | Pet, context: AddMarkContext): void {
    super.OnMarkCreated(target, context)
    if (!(target instanceof Pet)) return
    this.addStatStageModifier(target)
  }

  private addStatStageModifier(pet: Pet) {
    // Remove existing modifier if any
    this.cleanupStatStageModifier()

    // Create stage modifier using the computed Observable for automatic updates
    const modifier = new Modifier(
      DurationType.binding,
      `stat_stage_${this.statType}_${this.id}`,
      this.stageMultiplier$, // 传入computed Observable，会自动响应level变化
      'percent',
      1000, // High priority for stage modifiers
      this,
    )

    // Add modifier to attribute system
    this.modifierCleanupFn = pet.attributeSystem.addModifier(this.statType, modifier)
  }

  private getStageMultiplier(stage: number): number {
    const validStage = Math.max(-6, Math.min(6, stage)) // 强制等级范围
    const index = validStage + 6
    const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
    const multiplier = STAT_STAGE_MULTIPLIER[index]

    // Convert multiplier to percentage for percent modifier system
    // multiplier 0.25 -> -75%, multiplier 1.5 -> 50%, multiplier 2.0 -> 100%
    return (multiplier - 1) * 100
  }

  attachTo(target: Pet | Battle) {
    super.attachTo(target)
    if (target instanceof Pet) {
      this.addStatStageModifier(target)
    }
  }

  detach(): void {
    super.detach()
    this.cleanupStatStageModifier()
  }

  /**
   * Clean up the stat stage modifier
   */
  public cleanupStatStageModifier(): void {
    if (this.modifierCleanupFn) {
      this.modifierCleanupFn()
      this.modifierCleanupFn = undefined
    }
  }

  public isOppositeMark(other: StatLevelMarkInstanceImpl): boolean {
    return this.base.statType === other.base.statType && Math.sign(this.level) !== Math.sign(other.level)
  }
}

export function CreateStatStageMark(statType: StatTypeWithoutHp, level: number): BaseStatLevelMark {
  return new BaseStatLevelMark(statType, level, `stat_stage_${statType}_${level > 0 ? 'up' : 'down'}` as baseMarkId)
}

// MarkSystem has been replaced by Mark-related Phase classes
// All mark management logic is now handled by the Phase system:
// - AddMarkPhase, RemoveMarkPhase, MarkStackPhase, MarkUpdatePhase, etc.
