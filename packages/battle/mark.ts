import {
  STAT_STAGE_MULTIPLIER,
  StatTypeWithoutHp,
  type baseMarkId,
  type markId,
  type effectStateId,
} from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import type { MarkMessage } from '@test-battle/const/message'
import { StackStrategy } from '@test-battle/const/stackStrategy'
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
import { Effect, type EffectContainer, EffectScheduler } from './effect'
import { type Instance, type MarkOwner, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import { nanoid } from 'nanoid'

export type MarkConfig = {
  duration: number
  persistent: boolean
  maxStacks: number
  stackable: boolean
  stackStrategy: StackStrategy
  destroyable: boolean
  isShield: boolean
  keepOnSwitchOut: boolean
  transferOnSwitch: boolean
  inheritOnFaint: boolean
  [id: string]: any
}

export interface IBaseMark extends Prototype {
  createInstance(...arg: any[]): MarkInstance
}

export class BaseMark implements Prototype, IBaseMark {
  constructor(
    public readonly id: baseMarkId,
    public readonly name: string,
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

export interface MarkInstance extends EffectContainer, OwnedEntity<MarkOwner | null>, Instance {
  _stack: number
  duration: number
  owner: MarkOwner | null
  isActive: boolean

  readonly id: markId
  name: string
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
  public owner: MarkOwner | null = null
  public isActive: boolean = true

  public readonly id: markId
  public name: string
  public readonly effects: Effect<EffectTrigger>[]
  public config: Partial<MarkConfig> = { destroyable: true }
  public readonly tags: string[] = []

  constructor(
    public readonly base: BaseMark,
    overrides?: {
      duration?: number
      stack?: number
      config?: Partial<BaseMark['config']>
      name?: string
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
    this._stack = overrides?.stack ?? base.config.maxStacks ?? 1
    this.config = mergedConfig
    this.name = overrides?.name ?? base.name
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

  setOwner(owner: MarkOwner): void {
    this.owner = owner
  }

  attachTo(target: MarkOwner) {
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
      this.destroy(new RemoveMarkContext(context, this))
    }

    return expired
  }

  addStack(value: number) {
    this.stack = Math.min(this.config.maxStacks ?? Infinity, this.stack + value)
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
      default:
        return false
    }
    // 只有当数值发生变化时才更新
    const changed = newStacks !== this.stack || newDuration !== this.duration
    this.stack = newStacks
    this.duration = newDuration
    this.isActive = true

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
        if (!effect.condition || effect.condition(effectContext)) {
          baseContext.battle.effectScheduler.addEffect(effect, effectContext)
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
  }

  public transfer(context: EffectContext<EffectTrigger> | SwitchPetContext, target: Battle | Pet) {
    this.attachTo(target)
    target.marks.push(this)
    context.battle.cleanupMarks()
  }

  toMessage(): MarkMessage {
    return {
      name: this.name,
      id: this.id,
      baseId: this.base.id,
      stack: this.stack,
      duration: this.duration,
      isActive: this.isActive,
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
      name,
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
    instance.updateName()
    return instance
  }
}

export class StatLevelMarkInstanceImpl extends MarkInstanceImpl implements MarkInstance {
  public level: number

  constructor(public readonly base: BaseStatLevelMark) {
    super(base)
    this.level = base.initialLevel
    this.updateName()
  }

  get statType() {
    return this.base.statType
  }

  get stack() {
    return this.level
  }

  public updateName() {
    this.name = `${this.base.statType.toUpperCase()} ${this.level > 0 ? '+' : ''}${this.level}`
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

      this.updateName()
      if (this.owner instanceof Pet) {
        this.owner.statStage[this.base.statType] = this.level
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
    this.updateName()

    if (this.owner instanceof Pet) {
      this.owner.statStage[this.base.statType] = this.level
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
    `stat-stage-${statType}-${level > 0 ? 'up' : 'down'}` as baseMarkId,
    `${statType.toUpperCase()} ${level > 0 ? '+' : ''}${level}`,
    [],
  )
}

export class MarkSystem {
  public marks: Map<markId, MarkInstance>
  constructor(private readonly battle: Battle) {}

  addMark(target: MarkOwner, context: AddMarkContext) {
    if (!context.available) return

    context.battle.applyEffects(context, EffectTrigger.OnBeforeAddMark)
    const config = {
      config: context.config,
      duration: context.duration ?? context.config?.duration,
      stack: context.stack ?? context.config?.maxStacks,
    }
    const newMark = context.baseMark.createInstance(config)

    // 以下是处理stageMark的逻辑
    if (target instanceof Pet) {
      const existingOppositeMark = target.marks.find(
        mark =>
          mark instanceof StatLevelMarkInstanceImpl &&
          newMark instanceof StatLevelMarkInstanceImpl &&
          mark.isOppositeMark(newMark),
      )

      if (existingOppositeMark) {
        existingOppositeMark.tryStack(context) // 触发抵消逻辑
        target.updateStat()
        return
      }
    }

    const existingMark = target.marks.find(mark => mark.base.id === context.baseMark.id)
    if (existingMark) {
      existingMark.tryStack(context)
    } else {
      context.battle.applyEffects(context, EffectTrigger.OnAddMark)
      context.battle.applyEffects(context, EffectTrigger.OnMarkCreate, newMark)
      newMark.attachTo(target)
      target.marks.push(newMark)
      if (newMark instanceof StatLevelMarkInstanceImpl && target instanceof Pet) {
        target.statStage[newMark.statType] = newMark.level
        target.updateStat()
      }
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
