import { Effect, EffectContainer, EffectTrigger, EffectApplicator } from './effect'
import { EffectContext } from './context'
import { Pet } from './pet'
import { BattleSystem } from './battleSystem'

export type StackStrategy =
  | 'stack' // 叠加层数并刷新持续时间
  | 'refresh' // 保持层数但刷新持续时间
  | 'extend' // 叠加层数并延长持续时间
  | 'max' // 取最大层数并刷新持续时间
  | 'replace' // 完全替换为新的印记

export class Mark implements EffectContainer {
  public stacks: number = 1
  public duration: number
  private owner?: Pet | BattleSystem

  constructor(
    public readonly id: string,
    private readonly effects: Effect[],
    private config: {
      duration?: number
      persistent?: boolean
      maxStacks?: number
      stackable?: boolean
      stackStrategy?: StackStrategy
    } = {},
    private readonly tags: string[],
  ) {
    this.duration = config.duration ?? 3
    this.config.stackStrategy = config.stackStrategy ?? 'stack'
  }

  getEffects(trigger: EffectTrigger): Effect[] {
    return this.effects.filter(e => e.trigger === trigger)
  }

  attachTo(target: Pet | BattleSystem) {
    this.owner = target
  }

  update(): boolean {
    if (this.config.persistent) return false
    this.duration--
    return this.duration <= 0
  }

  tryStack(newMark: Mark): boolean {
    if (!this.isStackable) return false

    const maxStacks = this.config.maxStacks ?? Infinity
    const strategy = this.config.stackStrategy!

    let newStacks = this.stacks
    let newDuration = this.duration

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

    return changed
  }

  get isStackable() {
    if (this.config.stackable !== undefined) return this.config.stackable
    return this.effects.some(e => e.meta?.stackable)
  }

  trigger(trigger: EffectTrigger, context: EffectContext) {
    const markContext: EffectContext = new EffectContext(context.battle, context, context.owner)
    EffectApplicator.apply(this, trigger, markContext)
  }

  clone(): Mark {
    const mark = new Mark(this.id, this.effects, this.config, this.tags)
    mark.stacks = this.stacks
    mark.duration = this.duration
    mark.owner = this.owner
    return mark
  }
}

export class MarkRegistry {
  private static marks = new Map<string, Effect[]>()

  static register(id: string, effects: Effect[]) {
    this.marks.set(id, effects)
  }

  static create(
    id: string,
    config?: {
      duration?: number
      persistent?: boolean
      maxStacks?: number
    },
    tags: string[] = [],
  ): Mark {
    const effects = this.marks.get(id)
    if (!effects) throw new Error(`Unknown mark: ${id}`)
    return new Mark(id, effects, config, tags)
  }
}
