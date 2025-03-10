import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { BattleMessageType } from '@test-battle/const/message'
import { Context, EffectContext } from './context'
import { type OwnedEntity, type Prototype } from './entity'
import { MarkInstance } from './mark'
import { SkillInstance } from './skill'
import type { effectId, effectStateId } from '@test-battle/const'

export class EffectState {
  id: effectStateId;
  [k: string]: any
  constructor(id: effectStateId) {
    this.id = id
  }
  get<T>(key: string): T {
    return this[key]
  }
  set<T>(key: string, value: T) {
    this[key] = value
  }
}

export class EffectScheduler {
  constructor() {}

  // 全局效果队列（按优先级排序）
  private globalEffectQueue: Array<{
    effect: Effect<EffectTrigger>
    context: EffectContext<EffectTrigger>
  }> = []

  // 添加效果到队列
  public addEffect(effect: Effect<EffectTrigger>, context: EffectContext<EffectTrigger>) {
    this.globalEffectQueue.push({ effect, context })

    // 按优先级降序排序（数值越大优先级越高）
    // TODO:应该还有一些不稳定的边界情况
    this.globalEffectQueue.sort((a, b) => b.effect.priority - a.effect.priority)
  }

  // 执行所有已排序效果
  public flushEffects() {
    while (this.globalEffectQueue.length > 0) {
      const { effect, context } = this.globalEffectQueue.shift()!
      context.battle.applyEffects(context, EffectTrigger.BeforeEffect)
      if (!context.available) {
        context.battle!.emitMessage(BattleMessageType.Info, { message: `${context.source.name}的效果被阻止了！` })
      }
      context.battle!.emitMessage(BattleMessageType.Info, { message: `${context.source.name}的效果被触发了！` })
      try {
        effect.innerApply(context)
      } catch (error) {
        console.error(`[Effect Error] ${effect.id}:`, error)
      } finally {
        context.battle.applyEffects(context, EffectTrigger.AfterEffect)
      }
    }
  }
}

export class Effect<T extends EffectTrigger> implements Prototype, OwnedEntity<SkillInstance | MarkInstance | null> {
  public owner: SkillInstance | MarkInstance | null = null
  constructor(
    public readonly id: effectId,
    public readonly trigger: T,
    public readonly apply: ((context: EffectContext<T>) => void) | ((context: EffectContext<T>) => void)[],
    public readonly priority: number,
    public readonly condition?: (context: EffectContext<T>) => boolean,
    public readonly consumesStacks?: number, // 新增可选消耗层数配置
  ) {}

  public innerApply(context: EffectContext<T>) {
    // 先执行消耗逻辑
    if (context.source instanceof MarkInstance) {
      if (!context.source.isActive) return
      if (this.consumesStacks) {
        context.source.consumeStack(context, this.consumesStacks)
      }
    }

    // 执行实际效果
    if (Array.isArray(this.apply)) this.apply.forEach(a => a.call(this, context))
    else this.apply.call(this, context)
  }

  setOwner(owner: MarkInstance | SkillInstance): void {
    this.owner = owner
  }
}

export interface EffectContainer {
  collectEffects(trigger: EffectTrigger, baseContext: Context): void
  effectState: {
    [id: string]: EffectState
  }
}

export interface EffectConfig<T extends EffectTrigger> {
  id: string
  trigger: T
  apply: (context: EffectContext<T>) => void | ((context: EffectContext<T>) => void)[]
  priority: number
  condition?: (context: EffectContext<T>) => boolean
  consumesStacks?: number // 新增可选消耗层数配置
}

export function CreateEffect<T extends EffectTrigger>(config: EffectConfig<T>): Effect<T> {
  return new Effect(config.id as effectId, config.trigger, config.apply, config.priority, config.condition)
}
