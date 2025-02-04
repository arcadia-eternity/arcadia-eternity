// mark.ts
import { Effect, EffectContainer, EffectTrigger, EffectApplicator, EffectContext } from './effect'
import { Pet } from './pet'

export class Mark implements EffectContainer {
  public stacks: number = 1
  public duration: number
  private source: Pet | null = null

  constructor(
    public readonly id: string,
    private readonly effects: Effect[],
    private config: {
      duration?: number
      persistent?: boolean
      maxStacks?: number
    } = {},
  ) {
    this.duration = config.duration ?? 3
  }

  getEffects(trigger: EffectTrigger): Effect[] {
    return this.effects.filter(e => e.trigger === trigger)
  }

  attachTo(target: Pet, source?: Pet) {
    this.source = source || null
    target.addMark(this)
  }

  update(): boolean {
    if (this.config.persistent) return false
    this.duration--
    return this.duration <= 0
  }

  tryStack(newMark: Mark): boolean {
    if (!this.isStackable) return false
    if (this.stacks >= (this.config.maxStacks ?? 5)) return false

    this.stacks += newMark.stacks
    this.duration = Math.max(this.duration, newMark.duration)
    return true
  }

  get isStackable() {
    return this.effects.some(e => e.meta?.stackable)
  }

  trigger(trigger: EffectTrigger, context: Omit<EffectContext, 'mark'>) {
    const markContext: EffectContext = {
      ...context,
      source: this,
    }
    EffectApplicator.apply(this, trigger, markContext)
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
  ): Mark {
    const effects = this.marks.get(id)
    if (!effects) throw new Error(`Unknown mark: ${id}`)
    return new Mark(id, effects, config)
  }
}
