import { OwnedEntity, Prototype } from './const'
import { Context, EffectContext } from './context'
import { Mark } from './mark'
import { BattleMessageType } from './message'
import { Skill } from './skill'

export class EffectScheduler {
  private static instance: EffectScheduler
  private constructor() {}

  public static getInstance(): EffectScheduler {
    if (!EffectScheduler.instance) {
      EffectScheduler.instance = new EffectScheduler()
    }
    return EffectScheduler.instance
  }

  // 全局效果队列（按优先级排序）
  private globalEffectQueue: Array<{
    effect: Effect<EffectTrigger>
    context: EffectContext<EffectTrigger>
  }> = []

  // 添加效果到队列
  public addEffect(effect: Effect<EffectTrigger>, context: EffectContext<EffectTrigger>) {
    this.globalEffectQueue.push({ effect, context })

    // 按优先级降序排序（数值越大优先级越高）
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

// 统一效果触发阶段
export enum EffectTrigger {
  OnBattleStart = 'ON_BATTLE_START',

  //以下EffectTrigger下的，context的parent一定是UseSkillContext
  BeforeSort = 'BEFORE_SORT',
  BeforeAttack = 'BEFORE_ATTACK',
  PreDamage = 'PRE_DAMAGE',
  OnCritPreDamage = 'ON_CRIT_PRE_DAMAGE',
  OnDamage = 'ON_DAMAGE',
  PostDamage = 'POST_DAMAGE',
  OnCritPostDamage = 'ON_CRIT_POST_DAMAGE',
  OnHit = 'ON_HIT',
  OnMiss = 'ON_MISS',
  AfterAttacked = 'AFTER_ATTACKED',
  OnDefeat = 'ON_DEFEAT',

  // 印记相关
  TurnStart = 'TURN_START',
  TurnEnd = 'TURN_END',

  //仅作用于自身触发
  OnAddMark = 'ON_ADD_MARK',
  OnRemoveMark = 'ON_REMOVE_MARK',

  OnMarkCreate = 'ON_MARK_CREATE',
  OnMarkDestroy = 'ON_MARK_DESTROY',

  //以下一定是EffectContext
  OnStack = 'ON_STACK',
  OnHeal = 'ON_HEAL',
  OnRageGain = 'ON_RAGE_GAIN',
  OnRageLoss = 'ON_RAGE_LOSS',

  OnSwitchIn = 'ON_SWITCH_IN',
  OnSwitchOut = 'ON_SWITCH_OUT',

  BeforeEffect = 'BEFORE_EFFECT',
  AfterEffect = 'AFTER_EFFECT',
}

export class Effect<T extends EffectTrigger> implements Prototype, OwnedEntity {
  public owner: Skill | Mark | null = null
  constructor(
    public readonly id: string,
    public readonly trigger: EffectTrigger,
    public readonly apply: (ctx: EffectContext<T>) => void,
    public readonly priority: number,
    public readonly condition?: (ctx: EffectContext<T>) => boolean,
    public readonly consumesStacks?: number, // 新增可选消耗层数配置
  ) {}

  public innerApply(ctx: EffectContext<T>) {
    // 先执行消耗逻辑
    if (ctx.source instanceof Mark) {
      if (!ctx.source.isActive) return
      if (this.consumesStacks) {
        ctx.source.consumeStacks(ctx, this.consumesStacks)
      }
    }

    // 执行实际效果
    this.apply.call(this, ctx)
  }

  setOwner(owner: Mark | Skill): void {
    this.owner = owner
  }

  clone(): Effect<T> {
    return new Effect(this.id, this.trigger, this.apply, this.priority, this.condition)
  }
}

// 效果容器接口
export interface EffectContainer {
  collectEffects(trigger: EffectTrigger, baseContext: Context): void
}

export interface EffectConfig<T extends EffectTrigger> {
  id: string
  trigger: T
  apply: (ctx: EffectContext<T>) => void
  priority: number
  condition?: (ctx: EffectContext<T>) => boolean
  consumesStacks?: number // 新增可选消耗层数配置
}

export function CreateEffect<T extends EffectTrigger>(config: EffectConfig<T>): Effect<T> {
  return new Effect(config.id, config.trigger, config.apply, config.priority, config.condition)
}
