import {
  BattleMessageType,
  EffectTrigger,
  type MarkMessage,
  StackStrategy,
  StatTypeWithoutHp,
  type MarkConfig,
  type baseMarkId,
  type markId,
  type Events,
} from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { Subject } from 'rxjs'
import { Battle } from './battle'
import {
  AddMarkContext,
  type AllContext,
  DamageContext,
  EffectContext,
  RemoveMarkContext,
  StackContext,
  SwitchPetContext,
  TurnContext,
} from './context'
import { Effect, type EffectContainer } from './effect'
import { type Instance, type MarkOwner, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import type { Emitter } from 'mitt'
import {
  Modifier,
  DurationType,
  MarkAttributeSystem,
  createStatLevelMarkAttributeSystem,
  computed,
  type BaseMarkAccessors,
  type LevelAccessors,
} from './attributeSystem'
import { Observable } from 'rxjs'

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
  update(context: TurnContext): boolean
  addStack(value: number): void
  tryStack(context: AddMarkContext): boolean
  consumeStack(context: EffectContext<EffectTrigger> | DamageContext, amount: number): number
  get isStackable(): boolean
  collectEffects(trigger: EffectTrigger, baseContext: AllContext): void
  destroy(
    context:
      | EffectContext<EffectTrigger>
      | TurnContext
      | AddMarkContext
      | SwitchPetContext
      | RemoveMarkContext
      | DamageContext,
  ): void
  transfer(context: EffectContext<EffectTrigger> | SwitchPetContext, target: Battle | Pet): void
  toMessage(): MarkMessage
}

export class MarkInstanceImpl implements MarkInstance {
  public owner: Battle | Pet | null = null

  public readonly id: markId
  public readonly effects: Effect<EffectTrigger>[]
  public config: Partial<MarkConfig> = { destroyable: true }
  public readonly tags: string[] = []

  public emitter?: Emitter<Events>

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
    this.effects = [...base.effects, ...(overrides?.effects || [])]

    this.config.isShield = mergedConfig.isShield ?? false
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

  update(context: TurnContext): boolean {
    if (!this.isActive) return true
    if (this.config.persistent) return false

    this.duration--
    const expired = this.duration <= 0

    if (expired) {
      context.battle.applyEffects(context, EffectTrigger.OnMarkDurationEnd, this)
      context.battle.emitMessage(BattleMessageType.MarkExpire, {
        mark: this.id,
        target: this.owner instanceof Pet ? this.owner.id : 'battle',
      })
      this.destroy(new RemoveMarkContext(context, this))
      return expired
    }

    context.battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: this.owner instanceof Pet ? this.owner.id : 'battle',
      mark: this.toMessage(),
    })

    return expired
  }

  addStack(value: number) {
    this.stack = Math.min(this.config.maxStacks ?? Infinity, this.stack + value)

    // Note: dirty flag removed, attribute system handles recalculation automatically
  }

  tryStack(context: AddMarkContext): boolean {
    if (!this.isStackable) return false

    // 始终使用叠加印记的config
    this.config = context.config || context.baseMark.config
    const maxStacks = this.config.maxStacks ?? Infinity
    const strategy = this.config.stackStrategy!
    const config = {
      config: context.config,
      duration: context.duration ?? context.config?.duration,
      stack: context.stack ?? context.config?.maxStacks,
    }
    const newMark = context.baseMark.createInstance(config)

    // 保存叠层前的状态
    const stacksBefore = this.stack
    const durationBefore = this.duration

    let newStacks = this.stack
    let newDuration = this.duration

    // 根据策略计算新的值
    switch (strategy) {
      case StackStrategy.stack:
        newStacks = Math.min(newStacks + newMark.stack, maxStacks)
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case StackStrategy.refresh:
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case StackStrategy.extend:
        newStacks = Math.min(newStacks + newMark.stack, maxStacks)
        newDuration += newMark.duration
        break

      case StackStrategy.max:
        newStacks = Math.min(Math.max(newStacks, newMark.stack), maxStacks)
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case StackStrategy.replace:
        newStacks = Math.min(newMark.stack, maxStacks)
        newDuration = newMark.duration
        break

      case StackStrategy.remove:
        this.destroy(new RemoveMarkContext(context, this))
        return true

      default:
        return false
    }

    // 创建StackContext
    const stackContext = new StackContext(
      context,
      this,
      newMark,
      stacksBefore,
      durationBefore,
      newStacks,
      newDuration,
      strategy,
    )

    // 触发OnStackBefore效果，允许在应用结果前修改叠层数值
    context.battle.applyEffects(stackContext, EffectTrigger.OnStackBefore)

    // 使用OnStackBefore effect可能修改过的值
    newStacks = stackContext.stacksAfter
    newDuration = stackContext.durationAfter

    // 应用最终结果
    const changed = newStacks !== this.stack || newDuration !== this.duration
    this.stack = newStacks
    this.duration = newDuration
    this.isActive = true

    // 触发OnStack效果，用于基于最终结果的副作用
    context.battle.applyEffects(stackContext, EffectTrigger.OnStack)

    // 检查是否需要销毁印记（当层数为0时）
    if (this.stack <= 0) {
      this.destroy(new RemoveMarkContext(context, this))
      return true
    }

    // Note: dirty flag removed, attribute system handles recalculation automatically

    context.battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: this.owner instanceof Pet ? this.owner.id : 'battle',
      mark: this.toMessage(),
    })

    return changed
  }

  consumeStack(context: EffectContext<EffectTrigger> | DamageContext, amount: number): number {
    const actual = Math.min(amount, this.stack)
    this.stack -= actual

    if (this.stack <= 0) {
      this.destroy(new RemoveMarkContext(context, this))
    }

    // Note: dirty flag removed, attribute system handles recalculation automatically

    return actual
  }

  get isStackable() {
    if (this.config.stackable !== undefined) return this.config.stackable
    return false
  }

  collectEffects(trigger: EffectTrigger, baseContext: AllContext) {
    if (!this.isActive) return

    this.effects
      .filter(effect => effect.trigger === trigger)
      .forEach(effect => {
        const effectContext = new EffectContext(baseContext, trigger, this, effect)
        try {
          if (!effect.condition || effect.condition(effectContext)) {
            baseContext.battle.effectScheduler.addEffect(effect, effectContext)
          }
        } catch (err) {
          console.error(err)
        }
      })
  }

  // Add an attribute modifier cleanup function
  addAttributeModifierCleanup(cleanup: () => void) {
    this.attributeModifierCleanups.push(cleanup)
  }

  // Clean up all attribute modifiers
  private cleanupAttributeModifiers() {
    // Use individual cleanup functions first
    this.attributeModifierCleanups.forEach(cleanup => cleanup())
    this.attributeModifierCleanups = []

    // Also use the bulk removal method as a safety net
    if (this.owner instanceof Pet) {
      this.owner.attributeSystem.removeModifiersFromSource(this.id)
    }
  }

  destroy(context: RemoveMarkContext) {
    if (!this.isActive || !this.config.destroyable) return
    this.isActive = false

    // Clean up attribute modifiers before destroying the mark
    this.cleanupAttributeModifiers()

    //TODO:这俩的语义感觉能分一下
    context.battle.applyEffects(context, EffectTrigger.OnMarkDestroy, this)
    context.battle.applyEffects(context, EffectTrigger.OnRemoveMark)
    context.battle.cleanupMarks()

    // Note: dirty flag removed, attribute system handles recalculation automatically
    context.battle.emitMessage(BattleMessageType.MarkDestroy, {
      mark: this.id,
      target: this.owner instanceof Pet ? this.owner.id : 'battle',
    })
  }

  public transfer(context: EffectContext<EffectTrigger> | SwitchPetContext, target: Battle | Pet) {
    this.attachTo(target)
    target.marks.push(this)
    context.battle.cleanupMarks()
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
    if (this.modifierCleanupFn) {
      this.modifierCleanupFn()
    }

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

  tryStack(context: AddMarkContext): boolean {
    const otherMark = context.baseMark

    // 检查是否为同类型的StatLevel印记
    const isSameStatType = otherMark instanceof BaseStatLevelMark && otherMark.statType === this.base.statType
    if (!isSameStatType) return super.tryStack(context)

    // 计算新的level值，应用等级限制
    const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
    const maxLevel = (STAT_STAGE_MULTIPLIER.length - 1) / 2
    const newLevel = Math.max(-maxLevel, Math.min(maxLevel, this.level + otherMark.initialLevel))

    // 如果新level为0，销毁印记
    if (newLevel === 0) {
      this.destroy(new RemoveMarkContext(context, this))
      return true
    }

    // 检查是否需要更换baseId（符号是否发生变化）
    if (Math.sign(this.level) !== Math.sign(newLevel)) {
      // 符号变化，需要创建新印记以确保正确的baseId
      this.replaceWithNewMark(context, newLevel)
    } else {
      // 符号未变化，直接设置level
      this.level = newLevel
    }

    return true
  }

  attachTo(target: Pet | Battle) {
    super.attachTo(target)
    if (target instanceof Pet) {
      this.addStatStageModifier(target)
    }
  }

  detach(): void {
    super.detach()
    if (this.modifierCleanupFn) {
      this.modifierCleanupFn()
      this.modifierCleanupFn = undefined
    }
  }

  override destroy(context: RemoveMarkContext): void {
    // Clean up the modifier when the mark is destroyed
    if (this.modifierCleanupFn) {
      this.modifierCleanupFn()
      this.modifierCleanupFn = undefined
    }
    // Clean up the statLevelAttributeSystem
    // Note: AttributeSystem doesn't need explicit cleanup as it uses BehaviorSubjects
    // which will be garbage collected when no longer referenced
    super.destroy(context)
  }

  public isOppositeMark(other: StatLevelMarkInstanceImpl): boolean {
    return this.base.statType === other.base.statType && Math.sign(this.level) !== Math.sign(other.level)
  }

  /**
   * 替换当前印记为具有正确baseId的新印记
   * 用于处理相反印记叠加或符号变化的情况
   */
  private replaceWithNewMark(context: AddMarkContext, newLevel: number): void {
    if (!this.owner) return

    // 创建具有正确baseId的新BaseMark
    const newBaseMark = CreateStatStageMark(this.base.statType, newLevel)

    // 保存当前印记的属性
    const currentDuration = this.duration
    const currentConfig = { ...this.config }

    // 创建新印记实例
    const newMarkInstance = newBaseMark.createInstance()

    // 设置正确的level
    newMarkInstance.level = newLevel

    // 设置其他属性
    newMarkInstance.duration = currentDuration
    newMarkInstance.config = currentConfig

    // 设置新印记的owner和emitter
    if (this.emitter) {
      newMarkInstance.setOwner(this.owner, this.emitter)
    }

    // 在marks数组中替换当前印记
    const markIndex = this.owner.marks.indexOf(this)
    if (markIndex !== -1) {
      this.owner.marks[markIndex] = newMarkInstance
    }

    // 清理当前印记的modifier
    if (this.modifierCleanupFn) {
      this.modifierCleanupFn()
      this.modifierCleanupFn = undefined
    }

    // 为新印记添加modifier
    if (this.owner instanceof Pet) {
      newMarkInstance.addStatStageModifier(this.owner)
    }

    // 设置当前印记为非活跃状态，但不调用destroy以避免触发额外的清理逻辑
    this.isActive = false

    // 发送印记更新消息
    context.battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: this.owner instanceof Pet ? this.owner.id : 'battle',
      mark: newMarkInstance.toMessage(),
    })
  }
}

export function CreateStatStageMark(statType: StatTypeWithoutHp, level: number): BaseStatLevelMark {
  return new BaseStatLevelMark(statType, level, `stat_stage_${statType}_${level > 0 ? 'up' : 'down'}` as baseMarkId)
}

export class MarkSystem {
  // public marks: Map<markId, MarkInstance>
  constructor(private readonly battle: Battle) {}

  addMark(target: Battle | Pet, context: AddMarkContext) {
    context.battle.applyEffects(context, EffectTrigger.OnBeforeAddMark)
    if (!context.available) {
      return
    }

    if (context.baseMark.config.mutexGroup) {
      // 获取同owner下同互斥组的现有印记
      const existingMarks = context.target.marks.filter(m => m.config.mutexGroup === context.baseMark.config.mutexGroup)

      // 移除所有冲突印记
      existingMarks.forEach(mark => mark.destroy(context))
    }

    const config = {
      config: context.config,
      duration: context.duration ?? context.config?.duration,
      stack: context.stack ?? context.config?.maxStacks,
    }
    const newMark = context.baseMark.createInstance(config)

    const existingOppositeMark = target.marks.find(
      mark =>
        mark instanceof StatLevelMarkInstanceImpl &&
        newMark instanceof StatLevelMarkInstanceImpl &&
        mark.isOppositeMark(newMark),
    )

    const existingMark = target.marks.find(mark => mark.base.id === context.baseMark.id)
    if (existingMark || existingOppositeMark) {
      if (existingMark) {
        existingMark.tryStack(context)
        return
      } else if (existingOppositeMark) {
        existingOppositeMark.tryStack(context)
        return
      }
    } else {
      newMark.OnMarkCreated(target, context)
      context.battle.emitMessage(BattleMessageType.MarkApply, {
        baseMarkId: context.baseMark.id,
        target: context.target instanceof Pet ? context.target.id : 'battle',
        mark: newMark.toMessage(),
      })
      return
    }
  }

  public removeMark(target: MarkOwner, context: RemoveMarkContext) {
    target.marks.forEach(mark => {
      const filltered = mark.id !== context.mark.id
      if (filltered) mark.destroy(context)
      return false
    })
    // Note: dirty flag removed, attribute system handles recalculation automatically
  }

  /**
   * Transfer marks from one pet to another during pet switching
   * Moved from Pet.transferMarks method
   */
  public transferMarks(context: SwitchPetContext, targetPet: Pet, ...marks: MarkInstance[]) {
    marks.forEach(mark => {
      mark.detach()
      const existingMark = targetPet.marks.find(m => m.base.id === mark.base.id)
      if (existingMark) {
        // 创建 AddMarkContext，使用当前 SwitchPetContext 作为父上下文，这个被视为隐式的effect
        const effectContext = new EffectContext(context, EffectTrigger.OnOwnerSwitchOut, mark, undefined)
        // 印记覆盖的config替代原来的config
        const addMarkContext = new AddMarkContext(
          effectContext,
          targetPet,
          mark.base,
          mark.stack,
          mark.duration,
          mark.config,
        )
        existingMark.tryStack(addMarkContext)
      } else {
        // 添加新印记
        mark.transfer(context, targetPet)
      }
    })
  }

  /**
   * Handle mark cleanup and transfer during pet switch out
   * Moved from Pet.switchOut method
   */
  public handleSwitchOut(context: SwitchPetContext, pet: Pet) {
    context.battle.applyEffects(context, EffectTrigger.OnOwnerSwitchOut, ...pet.marks)
    pet.marks = pet.marks.filter(mark => {
      const shouldKeep = mark.config.keepOnSwitchOut ?? false
      const shouldTransfer = mark.config.transferOnSwitch && context.target

      // 需要转移的印记
      if (mark.config.transferOnSwitch && context.target) {
        this.transferMarks(context, context.target, mark)
      } else if (!shouldKeep) {
        mark.destroy(context)
      }

      return shouldKeep || shouldTransfer
    })
  }
}
