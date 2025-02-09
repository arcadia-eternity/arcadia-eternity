import { Effect, type EffectContainer, EffectScheduler, EffectTrigger } from './effect'
import { AddMarkContext, type AllContext, EffectContext, TurnContext } from './context'
import { Pet } from './pet'
import { BattleSystem } from './battleSystem'
import { type OwnedEntity, type Prototype } from './const'

export type StackStrategy =
  | 'stack' // 叠加层数并刷新持续时间
  | 'refresh' // 保持层数但刷新持续时间
  | 'extend' // 叠加层数并延长持续时间
  | 'max' // 取最大层数并刷新持续时间
  | 'replace' // 完全替换为新的印记

export class Mark implements EffectContainer, Prototype, OwnedEntity {
  public stacks: number = 1
  public duration: number
  public owner: Pet | BattleSystem | null = null
  public isActive: boolean = true

  constructor(
    public readonly id: number,
    public readonly name: string,
    private readonly effects: Effect<EffectTrigger>[],
    private config: {
      duration?: number
      persistent?: boolean
      maxStacks?: number
      stackable?: boolean
      stackStrategy?: StackStrategy
      destoyable?: boolean
    } = {
      destoyable: true,
    },
    private readonly tags: string[] = [],
  ) {
    this.duration = config.duration ?? 3
    this.config.stackStrategy = config.stackStrategy ?? 'stack'
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
    this.stacks = Math.min(this.config.maxStacks ?? Infinity, this.stacks + value)
  }

  tryStack(ctx: AddMarkContext): boolean {
    if (!this.isStackable) return false

    const maxStacks = this.config.maxStacks ?? Infinity
    const strategy = this.config.stackStrategy!
    const newMark = ctx.mark

    let newStacks = this.stacks
    let newDuration = this.duration

    ctx.battle.applyEffects(ctx, EffectTrigger.OnStack)

    switch (strategy) {
      case 'stack':
        newStacks = Math.min(newStacks + newMark.stacks, maxStacks)
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case 'refresh':
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case 'extend':
        newStacks = Math.min(newStacks + newMark.stacks, maxStacks)
        newDuration += newMark.duration
        break

      case 'max':
        newStacks = Math.min(Math.max(newStacks, newMark.stacks), maxStacks)
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case 'replace':
        newStacks = Math.min(newMark.stacks, maxStacks)
        newDuration = newMark.duration
        break
      default:
        return false
    }
    // 只有当数值发生变化时才更新
    const changed = newStacks !== this.stacks || newDuration !== this.duration
    this.stacks = newStacks
    this.duration = newDuration
    this.isActive = true

    return changed
  }

  consumeStacks(ctx: EffectContext<EffectTrigger>, amount: number): number {
    const actual = Math.min(amount, this.stacks)
    this.stacks -= actual

    if (this.stacks <= 0) {
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
    mark.stacks = this.stacks
    mark.duration = this.duration
    mark.owner = this.owner
    return mark
  }

  destory(ctx: EffectContext<EffectTrigger> | TurnContext) {
    if (!this.isActive || !this.config.destoyable) return
    this.isActive = false

    // 触发移除效果
    if (this.owner instanceof Pet) {
      ctx.battle.applyEffects(ctx, EffectTrigger.OnMarkDestroy)
      ctx.battle.cleanupMarks()
    }
  }
}

export class MarkRegistry {
  private static marks = new Map<number, Effect<EffectTrigger>[]>()

  static register(id: number, effects: Effect<EffectTrigger>[]) {
    this.marks.set(id, effects)
  }

  static create(
    id: number,
    name: string,
    config?: {
      duration?: number
      persistent?: boolean
      maxStacks?: number
      destoyable: boolean
    },
    tags: string[] = [],
  ): Mark {
    const effects = this.marks.get(id)
    if (!effects) throw new Error(`Unknown mark: ${id}`)
    return new Mark(id, name, effects, config, tags)
  }
}
