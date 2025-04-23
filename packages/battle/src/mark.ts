import {
  BattleMessageType,
  EffectTrigger,
  type MarkMessage,
  STAT_STAGE_MULTIPLIER,
  StackStrategy,
  StatTypeWithoutHp,
  type MarkConfig,
  type baseMarkId,
  type markId,
} from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { Battle } from './battle'
import {
  AddMarkContext,
  type AllContext,
  DamageContext,
  EffectContext,
  RemoveMarkContext,
  SwitchPetContext,
  TurnContext,
} from './context'
import { Effect, type EffectContainer } from './effect'
import { type Instance, type MarkOwner, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'

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
  _stack: number
  duration: number
  owner: Pet | Battle | null
  isActive: boolean

  readonly id: markId
  readonly effects: Effect<EffectTrigger>[]
  config: Partial<MarkConfig>
  readonly tags: string[]

  readonly base: BaseMark

  get stack(): number
  set stack(value: number)
  get baseId(): baseMarkId
  setOwner(owner: MarkOwner): void
  attachTo(target: MarkOwner): void
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
  public _stack: number = 1
  public duration: number
  public owner: Battle | Pet | null = null
  public isActive: boolean = true

  public readonly id: markId
  public readonly effects: Effect<EffectTrigger>[]
  public config: Partial<MarkConfig> = { destroyable: true }
  public readonly tags: string[] = []

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

    this.duration = overrides?.duration ?? mergedConfig.duration ?? base.config.duration ?? 3
    if (mergedConfig.persistent) this.duration = -1
    this._stack = overrides?.stack ?? base.config.maxStacks ?? 1
    this.config = mergedConfig
    this.tags = [...base.tags, ...(overrides?.tags || [])]
    this.effects = [...base.effects, ...(overrides?.effects || [])]

    this.config.isShield = mergedConfig.isShield ?? false
  }

  get stack(): number {
    return this._stack
  }

  set stack(value: number) {
    this._stack = value
  }

  get baseId(): baseMarkId {
    return this.base.id
  }

  onAddMark(target: Battle | Pet, context: AddMarkContext) {
    context.battle.applyEffects(context, EffectTrigger.OnAddMark)
    context.battle.applyEffects(context, EffectTrigger.OnMarkCreate, this)
    this.attachTo(target)
    target.marks.push(this)
    if (target instanceof Pet) {
      target.updateStat()
    }
  }

  setOwner(owner: Battle | Pet): void {
    this.owner = owner
  }

  attachTo(target: Battle | Pet) {
    this.owner = target
  }

  private detach() {
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

    if (this.owner instanceof Pet) {
      this.owner.updateStat()
    }
  }

  tryStack(context: AddMarkContext): boolean {
    if (!this.isStackable) return false

    // 始终使用叠加印记的config
    this.config = context.config || context.baseMark.config
    const maxStacks = this.config.maxStacks ?? Infinity
    const strategy = this.config.stackStrategy!
    const newMark = new MarkInstanceImpl(context.baseMark)

    let newStacks = this.stack
    let newDuration = this.duration

    context.battle.applyEffects(context, EffectTrigger.OnStack)

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
    // 只有当数值发生变化时才更新
    const changed = newStacks !== this.stack || newDuration !== this.duration
    this.stack = newStacks
    this.duration = newDuration
    this.isActive = true

    if (this.owner instanceof Pet) {
      this.owner.updateStat()
    }

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

    if (this.owner instanceof Pet) {
      this.owner.updateStat()
    }

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
        const effectContext = new EffectContext(baseContext, trigger, this)
        try {
          if (!effect.condition || effect.condition(effectContext)) {
            baseContext.battle.effectScheduler.addEffect(effect, effectContext)
          }
        } catch (err) {
          console.error(err)
        }
      })
  }

  destroy(context: RemoveMarkContext) {
    if (!this.isActive || !this.config.destroyable) return
    this.isActive = false

    //TODO:这俩的语义感觉能分一下
    context.battle.applyEffects(context, EffectTrigger.OnMarkDestroy, this)
    context.battle.applyEffects(context, EffectTrigger.OnRemoveMark)
    context.battle.cleanupMarks()

    // 触发移除效果
    if (this.owner instanceof Pet) {
      this.owner.updateStat()
    }
    context.battle.emitMessage(BattleMessageType.MarkDestory, {
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
    name: string,
    effects: Effect<EffectTrigger>[] = [],
  ) {
    super(
      id,
      effects,
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
  public level: number
  //一般是Pet，我知道你们可能会尝试加到奇怪的地方。
  declare public owner: Pet | null

  constructor(public readonly base: BaseStatLevelMark) {
    super(base)
    this.level = base.initialLevel
  }

  get statType() {
    return this.base.statType
  }

  get stack() {
    return Math.abs(this.level)
  }

  override onAddMark(target: Battle | Pet, context: AddMarkContext): void {
    super.onAddMark(target, context)
    if (!(target instanceof Pet)) return
    target.statStage[this.statType] = this.level
  }

  tryStack(context: AddMarkContext): boolean {
    const otherMark = context.baseMark

    if (otherMark instanceof StatLevelMarkInstanceImpl && this.isOppositeMark(otherMark)) {
      const remainingLevel = this.level + otherMark.level

      if (remainingLevel === 0) {
        this.destroy(new RemoveMarkContext(context, this))
        return true
      } else if (Math.sign(remainingLevel) === Math.sign(this.level)) {
        this.level = remainingLevel
      } else {
        this.level = remainingLevel
      }

      if (this.owner instanceof Pet) {
        this.owner.statStage[this.base.statType] = this.level
        this.owner.updateStat()
      }
      return true
    }

    const isSameType = otherMark instanceof BaseStatLevelMark && otherMark.statType === this.base.statType

    if (!isSameType) return super.tryStack(context)

    const maxLevel = (STAT_STAGE_MULTIPLIER.length - 1) / 2
    const newLevel = Math.max(-maxLevel, Math.min(maxLevel, this.level + otherMark.initialLevel))

    if (newLevel === 0) {
      this.destroy(new RemoveMarkContext(context, this))
      return true
    }

    this.level = newLevel

    if (this.owner instanceof Pet) {
      this.owner.statStage[this.base.statType] = this.level
      this.owner.updateStat()
    }

    return true
  }

  attachTo(target: Pet | Battle) {
    super.attachTo(target)
    if (target instanceof Pet) {
      target.statStage[this.base.statType] = this.level
    }
  }

  public isOppositeMark(other: StatLevelMarkInstanceImpl): boolean {
    return this.base.statType === other.base.statType && Math.sign(this.level) !== Math.sign(other.level)
  }
}

export function CreateStatStageMark(statType: StatTypeWithoutHp, level: number): BaseStatLevelMark {
  return new BaseStatLevelMark(
    statType,
    level,
    `stat_stage_${statType}_${level > 0 ? 'up' : 'down'}` as baseMarkId,
    `${statType.toUpperCase()} ${level > 0 ? '+' : ''}${level}`,
    [],
  )
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
      newMark.onAddMark(target, context)
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
    if (target instanceof Pet) target.updateStat()
  }
}
