import { Effect, type EffectContainer, EffectScheduler, EffectTrigger } from './effect'
import { AddMarkContext, type AllContext, EffectContext, TurnContext } from './context'
import { Pet } from './pet'
import { BattleSystem } from './battleSystem'
import { STAT_STAGE_MULTIPLIER, StatTypeOnBattle, type OwnedEntity, type Prototype } from './const'
import { MarkMessage } from './message'

export enum StackStrategy {
  'stack', // 叠加层数并刷新持续时间
  'refresh', // 保持层数但刷新持续时间
  'extend', // 叠加层数并延长持续时间
  'max', // 取最大层数并刷新持续时间
  'replace', // 完全替换为新的印记
}

//TODO: 印记的换场逻辑，以及传递的逻辑。
export class Mark implements EffectContainer, Prototype, OwnedEntity {
  public _stack: number = 1
  public duration: number
  public owner: Pet | BattleSystem | null = null
  public isActive: boolean = true

  constructor(
    public readonly id: string,
    public name: string,
    public readonly effects: Effect<EffectTrigger>[],
    public config: {
      duration?: number
      persistent?: boolean
      maxStacks?: number
      stackable?: boolean
      stackStrategy?: StackStrategy
      destoyable?: boolean
    } = {
      destoyable: true,
    },
    public readonly tags: string[] = [],
  ) {
    this.duration = config.duration ?? 3
    this.config.stackStrategy = config.stackStrategy ?? StackStrategy.stack
  }

  get stack(): number {
    return this._stack
  }

  set stack(value: number) {
    this._stack = value
  }

  setOwner(owner: BattleSystem | Pet): void {
    this.owner = owner
  }

  attachTo(target: Pet | BattleSystem) {
    this.owner = target
  }

  private detach() {
    if (this.owner) {
      this.owner.marks = this.owner.marks.filter(m => m !== this)
    }
    this.owner = null
  }

  update(ctx: TurnContext): boolean {
    if (!this.isActive) return true
    if (this.config.persistent) return false

    this.duration--
    const expired = this.duration <= 0

    if (expired) {
      this.destory(ctx)
    }

    return expired
  }

  addStack(value: number) {
    this.stack = Math.min(this.config.maxStacks ?? Infinity, this.stack + value)
  }

  tryStack(ctx: AddMarkContext): boolean {
    if (!this.isStackable) return false

    const maxStacks = this.config.maxStacks ?? Infinity
    const strategy = this.config.stackStrategy!
    const newMark = ctx.mark

    let newStacks = this.stack
    let newDuration = this.duration

    ctx.battle.applyEffects(ctx, EffectTrigger.OnStack)

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

  consumeStack(ctx: EffectContext<EffectTrigger>, amount: number): number {
    const actual = Math.min(amount, this.stack)
    this.stack -= actual

    if (this.stack <= 0) {
      this.destory(ctx)
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
          EffectScheduler.getInstance().addEffect(effect, effectContext)
        }
      })
  }

  clone(ctx: AddMarkContext): Mark {
    ctx.battle.applyEffects(ctx, EffectTrigger.OnMarkCreate)
    const mark = new Mark(this.id, this.name, this.effects, this.config, this.tags)
    mark.stack = this.stack
    mark.duration = this.duration
    return mark
  }

  destory(ctx: EffectContext<EffectTrigger> | TurnContext | AddMarkContext) {
    if (!this.isActive || !this.config.destoyable) return
    this.isActive = false

    // 触发移除效果
    if (this.owner instanceof Pet) {
      ctx.battle.applyEffects(ctx, EffectTrigger.OnMarkDestroy)
      ctx.battle.cleanupMarks()
    }
  }

  toMessage(): MarkMessage {
    return {
      name: this.name,
      id: this.id,
      stack: this.stack,
      duration: this.duration,
      isActive: this.isActive,
    }
  }
}

//能力强化印记
export class StatLevelMark extends Mark {
  constructor(
    public readonly statType: StatTypeOnBattle, // 改用StatTypeOnBattle类型
    public level: number,
    id: string,
    name: string,
    effects: Effect<EffectTrigger>[] = [],
    config: Mark['config'] = {
      destoyable: true,
    },
  ) {
    super(
      id,
      name,
      effects,
      {
        ...config,
        persistent: true,
        maxStacks: 6,
        stackStrategy: StackStrategy.stack,
      },
      ['statStage'],
    )
  }

  tryStack(ctx: AddMarkContext): boolean {
    const otherMark = ctx.mark

    // 如果对方是互斥的 StatLevelMark
    if (otherMark instanceof StatLevelMark && this.isOppositeMark(otherMark)) {
      // 计算抵消后的剩余等级
      const remainingLevel = this.level + otherMark.level

      if (remainingLevel === 0) {
        // 完全抵消，销毁当前印记
        this.destory(ctx)
        return true
      } else if (Math.sign(remainingLevel) === Math.sign(this.level)) {
        // 同方向叠加剩余等级
        this.level = remainingLevel
      } else {
        // 反转方向并更新等级
        this.level = remainingLevel
      }

      // 更新名称和所有者 statStage
      this.name = `${this.statType.toUpperCase()} ${this.level > 0 ? '+' : ''}${this.level}`
      if (this.owner instanceof Pet) {
        this.owner.statStage[this.statType] = this.level
      }
      return true
    }

    const isSameType = ctx.mark instanceof StatLevelMark && ctx.mark.statType === this.statType

    if (!isSameType) return super.tryStack(ctx)

    // 计算新等级
    const maxLevel = (STAT_STAGE_MULTIPLIER.length - 1) / 2
    const newLevel = Math.max(-maxLevel, Math.min(maxLevel, this.level + (ctx.mark as StatLevelMark).level))

    // 等级归零时标记为待移除
    if (newLevel === 0) {
      this.destory(ctx)
      return true
    }

    // 正常更新等级
    this.level = newLevel
    this.name = `${this.statType.toUpperCase()} ${this.level > 0 ? '+' : ''}${this.level}`

    if (this.owner instanceof Pet) {
      this.owner.statStage[this.statType] = this.level
    }

    return true
  }

  attachTo(target: Pet | BattleSystem) {
    super.attachTo(target)
    if (target instanceof Pet) {
      target.statStage[this.statType] = this.level
    }
  }

  public isOppositeMark(other: StatLevelMark): boolean {
    // 判断是否为同一属性但等级方向相反
    return this.statType === other.statType && Math.sign(this.level) !== Math.sign(other.level)
  }

  get stack() {
    return this.level
  }

  clone(ctx: AddMarkContext): StatLevelMark {
    ctx.battle.applyEffects(ctx, EffectTrigger.OnMarkCreate)
    const cloned = new StatLevelMark(this.statType, this.level, this.id, this.name, this.effects, this.config)
    return cloned
  }
}

export function CreateStatStageMark(statType: StatTypeOnBattle, level: number): StatLevelMark {
  return new StatLevelMark(
    statType,
    level,
    `stat-stage-${statType}-${level > 0 ? 'up' : 'down'}`,
    `${statType.toUpperCase()} ${level > 0 ? '+' : ''}${level}`,
    [],
    {
      persistent: true,
      duration: -1,
      maxStacks: 6,
      stackStrategy: StackStrategy.stack,
      destoyable: true,
    },
  )
}
