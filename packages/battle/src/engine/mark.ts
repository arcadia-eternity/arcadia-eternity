import type { DeferredDamage } from './phase/skill'
import { consumeMarkStacks } from './phase/consumeStack'
import { initializeOwnerRelations } from './values/relations'
import { normalizeMarkInstanceParams, type MarkInstanceParams } from './content/mark-parameters'
import {
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

import type { Battle } from './battle'
import { DamageContext, EffectContext } from './context'
import { Effect, type EffectContainer, type TemporaryEffect } from './effect'
import { type Instance, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import type { Emitter } from 'mitt'
import { AttributeSystem, type MarkAttributes, type LevelAttributes } from './attributeSystem'
import { Signal, projectValue, type ReactiveValue } from './reactiveValue'

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
    id?: markId
    instanceParams?: MarkInstanceParams
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
  isSuppressed: boolean

  deferredDamage?: DeferredDamage
  readonly instanceParams: MarkInstanceParams | undefined
  readonly base: BaseMark
  readonly attributeSystem: AttributeSystem<MarkAttributes>

  duration: number
  isActive: boolean

  get stack(): number
  set stack(value: number)
  get baseId(): baseMarkId
  registerBattle(battle: Battle): void
  consumeStack(context: EffectContext<EffectTrigger> | DamageContext, amount: number): number
  temporaryEffects: TemporaryEffect[]
  attributeModifierCleanups: (() => void)[]
  getEffects(trigger: EffectTrigger): Effect<EffectTrigger>[]
  toMessage(): MarkMessage
}

export class MarkInstanceImpl implements MarkInstance {
  temporaryEffects: TemporaryEffect[] = []

  getEffects(trigger: EffectTrigger): Effect<EffectTrigger>[] {
    return [...this.effects, ...this.temporaryEffects.map(entry => entry.effect)].filter(effect =>
      effect.triggers.includes(trigger),
    )
  }

  public deferredDamage?: DeferredDamage
  public readonly instanceParams: MarkInstanceParams | undefined
  private suppression = new Signal(false)
  get isSuppressed(): boolean {
    return this.suppression.value
  }
  set isSuppressed(value: boolean) {
    this.suppression.next(value)
  }
  public owner: Battle | Pet | null = null

  public readonly id: markId
  public readonly effects: Effect<EffectTrigger>[]
  public config: Partial<MarkConfig> = { destroyable: true }
  public readonly tags: string[] = []

  public emitter?: Emitter<Events>

  // Attribute system for managing mark parameters
  public readonly attributeSystem: AttributeSystem<MarkAttributes>

  // Store cleanup functions for attribute modifiers
  attributeModifierCleanups: (() => void)[] = []

  constructor(
    public readonly base: BaseMark,
    overrides?: {
      id?: markId
      instanceParams?: MarkInstanceParams
      duration?: number
      stack?: number
      config?: Partial<BaseMark['config']>
      tags?: string[]
      effects?: Effect<EffectTrigger>[]
    },
  ) {
    this.instanceParams = normalizeMarkInstanceParams(base, overrides?.instanceParams)
    initializeOwnerRelations(this)
    this.id = overrides?.id ?? (nanoid() as markId)
    const mergedConfig = {
      ...base.config,
      ...overrides?.config,
      // 确保枚举类型有默认值
      stackStrategy: overrides?.config?.stackStrategy ?? base.config.stackStrategy ?? StackStrategy.stack,
    }

    // Initialize attribute system with mark ID (battleId will be set later in setOwner)
    this.attributeSystem = new AttributeSystem<MarkAttributes>()

    // Initialize attribute system with mark parameters
    const duration = overrides?.duration ?? mergedConfig.duration ?? base.config.duration ?? 3
    const finalDuration = mergedConfig.persistent ? -1 : duration
    const stack = overrides?.stack ?? base.config.maxStacks ?? 1

    this.attributeSystem.registerBaseAttribute('duration', finalDuration)
    this.attributeSystem.registerBaseAttribute('stack', stack)
    this.attributeSystem.registerBaseAttribute('isActive', true)

    this.config = mergedConfig
    this.tags = [...base.tags, ...(overrides?.tags || [])]
    this.effects = [...base.effects, ...(overrides?.effects || [])]

    this.config.isShield = mergedConfig.isShield ?? false
  }

  get stack(): number {
    return this.attributeSystem.getCurrentValue('stack') as number
  }

  set stack(value: number) {
    this.attributeSystem.updateBaseValue('stack', Math.max(0, value))
  }

  get duration(): number {
    return this.attributeSystem.getCurrentValue('duration') as number
  }

  set duration(value: number) {
    this.attributeSystem.updateBaseValue('duration', value)
  }

  get isActive(): boolean {
    return this.attributeSystem.getCurrentValue('isActive') as boolean
  }

  set isActive(value: boolean) {
    this.attributeSystem.updateBaseValue('isActive', value)
  }

  get baseId(): baseMarkId {
    return this.base.id
  }

  setOwner(owner: Battle | Pet, emitter: Emitter<Events>): void {
    this.owner = owner
    this.emitter = emitter

    // Set battleId for attribute system
    const battle = owner instanceof Pet ? owner.owner?.battle : owner
    if (battle) this.registerBattle(battle)
  }

  /** Track lifetime without assigning an owner to an incoming stacking operand. */
  registerBattle(battle: Battle): void {
    this.attributeSystem.setBattleId(battle.id)
  }

  consumeStack(context: EffectContext<EffectTrigger> | DamageContext, amount: number): number {
    return consumeMarkStacks(context, this, amount)
  }

  toMessage(): MarkMessage {
    return {
      id: this.id,
      baseId: this.base.id,
      stack: this.stack,
      duration: this.duration,
      isActive: this.isActive && !this.isSuppressed,
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

  createInstance(overrides?: { id?: markId }): StatLevelMarkInstanceImpl {
    return new StatLevelMarkInstanceImpl(this, overrides?.id)
  }
}

export class StatLevelMarkInstanceImpl extends MarkInstanceImpl implements MarkInstance {
  //一般是Pet，我知道你们可能会尝试加到奇怪的地方。
  declare public owner: Pet | null
  modifierCleanupFn?: () => void

  // 使用组合的方式管理attributeSystem，专门用于StatLevel相关的属性
  private readonly statLevelAttributeSystem = new AttributeSystem<LevelAttributes>()

  // 使用computed创建自动计算的stage multiplier，基于attributeSystem的level
  readonly stageMultiplier$: ReactiveValue<number>

  constructor(
    public readonly base: BaseStatLevelMark,
    id?: markId,
  ) {
    super(base, { id })

    this.statLevelAttributeSystem.registerBaseAttribute('level', base.initialLevel)
    // 创建基于attributeSystem level的computed Observable
    this.stageMultiplier$ = projectValue(this.statLevelAttributeSystem.getAttribute$('level'), 'stage')
  }

  override registerBattle(battle: Battle): void {
    super.registerBattle(battle)
    this.statLevelAttributeSystem.setBattleId(battle.id)
  }

  // level的getter和setter，操作attributeSystem
  get level(): number {
    return this.statLevelAttributeSystem.getCurrentValue('level') as number
  }

  set level(value: number) {
    this.statLevelAttributeSystem.updateBaseValue('level', value)
  }

  get statType() {
    return this.base.statType
  }

  get stack() {
    return Math.abs(this.level)
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
