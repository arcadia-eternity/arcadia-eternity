import { EffectTrigger } from '@arcadia-eternity/const'
import { BattleMessageType } from '@arcadia-eternity/const'
import { Context, EffectContext, type TriggerContextMap } from './context'
import { type Prototype } from './entity'
import type { effectId } from '@arcadia-eternity/const'
import { MarkInstanceImpl } from './mark'
import { createChildLogger } from './logger'

export class EffectScheduler {
  private readonly logger = createChildLogger('EffectScheduler')

  constructor() {}

  private effectQueuesMap: WeakMap<
    Context,
    Array<{
      effect: Effect<EffectTrigger>
      context: EffectContext<EffectTrigger>
    }>
  > = new WeakMap()

  // 跟踪已添加的效果，防止同一个源对象的同一个效果重复触发
  private addedEffectsMap: WeakMap<Context, Set<string>> = new WeakMap()

  // 添加效果到队列
  public addEffect(effect: Effect<EffectTrigger>, context: EffectContext<EffectTrigger>) {
    if (!this.effectQueuesMap.has(context.parent)) this.effectQueuesMap.set(context.parent, [])
    if (!this.addedEffectsMap.has(context.parent)) this.addedEffectsMap.set(context.parent, new Set())

    const addedEffects = this.addedEffectsMap.get(context.parent)!

    // 创建一个唯一标识符，基于源对象和效果ID的组合
    // 使用源对象的引用和效果ID来确保同一个源对象的同一个效果不会重复添加
    const effectKey = `${(context.source as any).id || 'unknown'}_${effect.id}_${context.source.constructor.name}`

    // 检查是否已经添加过这个效果
    if (addedEffects.has(effectKey)) {
      this.logger.warn(
        `检测到重复的效果被跳过: 源对象=${(context.source as any).id || 'unknown'} (${context.source.constructor.name}), 效果=${effect.id}, 触发器=${context.trigger}`,
      )
      return // 跳过重复的效果
    }

    // 标记该效果已被添加
    addedEffects.add(effectKey)

    this.effectQueuesMap.get(context.parent)?.push({
      effect,
      context,
    })

    // 按优先级降序排序（数值越大优先级越高）
    // TODO:应该还有一些不稳定的边界情况
    this.effectQueuesMap.get(context.parent)?.sort((a, b) => b.effect.priority - a.effect.priority)
  }

  // 执行所有已排序效果
  public flushEffects<T extends EffectTrigger>(parentContext: TriggerContextMap[T]) {
    if (!this.effectQueuesMap.has(parentContext)) return
    try {
      const queue = this.effectQueuesMap.get(parentContext)!
      while (queue.length > 0) {
        const { effect, context } = queue.shift()!
        context.battle.applyEffects(context, EffectTrigger.BeforeEffect)
        if (!context.available) {
          context.battle!.emitMessage(BattleMessageType.EffectApplyFail, {
            source: context.source.id,
            effect: effect.id,
            reason: 'disabled',
          })
          continue
        }
        context.battle!.emitMessage(BattleMessageType.EffectApply, {
          source: context.source.id,
          effect: effect.id,
        })
        try {
          effect.innerApply(context)
        } catch (error) {
          this.logger.error(`Effect Error ${effect.id}:`, error)
        } finally {
          context.battle.applyEffects(context, EffectTrigger.AfterEffect)
        }
      }
    } finally {
      // 清理队列和效果跟踪
      if (this.effectQueuesMap.has(parentContext)) this.effectQueuesMap.delete(parentContext)
      if (this.addedEffectsMap.has(parentContext)) this.addedEffectsMap.delete(parentContext)
    }
  }
}

export class Effect<T extends EffectTrigger> implements Prototype {
  constructor(
    public readonly id: effectId,
    public readonly trigger: T,
    public readonly apply: ((context: EffectContext<T>) => void) | ((context: EffectContext<T>) => void)[],
    public readonly priority: number,
    public readonly condition?: (context: EffectContext<T>) => boolean,
    public readonly consumesStacks?: number,
    public readonly tags: string[] = [],
  ) {}

  public innerApply(context: EffectContext<T>) {
    // 先执行消耗逻辑
    if (context.source instanceof MarkInstanceImpl) {
      if (!context.source.isActive) return
      if (this.consumesStacks) {
        context.source.consumeStack(context, this.consumesStacks)
      }
    }

    // 执行实际效果
    if (Array.isArray(this.apply)) this.apply.forEach(a => a.call(this, context))
    else this.apply.call(this, context)
  }
}

export interface EffectContainer {
  collectEffects(trigger: EffectTrigger, baseContext: Context): void
}
