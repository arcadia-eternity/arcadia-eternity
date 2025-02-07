import { OwnedEntity, Prototype } from './const'
import { Context, EffectContext } from './context'
import { Mark } from './mark'
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
    effect: Effect
    context: EffectContext
  }> = []

  // 添加效果到队列
  public addEffect(effect: Effect, context: EffectContext) {
    this.globalEffectQueue.push({ effect, context })

    // 按优先级降序排序（数值越大优先级越高）
    this.globalEffectQueue.sort((a, b) => b.effect.priority - a.effect.priority)
  }

  // 执行所有已排序效果
  public flushEffects() {
    while (this.globalEffectQueue.length > 0) {
      const { effect, context } = this.globalEffectQueue.shift()!
      try {
        effect.innerApply(context)
      } catch (error) {
        console.error(`[Effect Error] ${effect.id}:`, error)
      } finally {
        // TODO
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

  // 印记相关
  TurnStart = 'TURN_START',
  TurnEnd = 'TURN_END',

  //以下一定是EffectContext
  OnStack = 'ON_STACK',
  OnHeal = 'ON_HEAL',

  OnRageGain = 'ON_RAGE_GAIN',
  OnRageLoss = 'ON_RAGE_LOSS',

  OnSwitchIn = 'ON_SWITCH_IN',
  OnSwitchOut = 'ON_SWITCH_OUT',
  OnDefeat = 'ON_DEFEAT',

  // AfterEffect = 'AFTER_EFFECT',
}

export class Effect implements Prototype, OwnedEntity {
  public owner: Skill | Mark | null = null
  constructor(
    public readonly id: string,
    public readonly trigger: EffectTrigger,
    public readonly apply: (ctx: EffectContext) => void,
    public readonly priority: number,
    public readonly condition?: (ctx: EffectContext) => boolean,
    public readonly consumesStacks?: number, // 新增可选消耗层数配置
  ) {}

  public innerApply(ctx: EffectContext) {
    // 先执行消耗逻辑
    if (ctx.source instanceof Mark) {
      if (!ctx.source.isActive) return
      if (this.consumesStacks) {
        ctx.source.consumeStacks(this.consumesStacks)
      }
    }

    // 执行实际效果
    this.apply(ctx)
  }

  setOwner(owner: Mark | Skill): void {
    this.owner = owner
  }

  clone(): Effect {
    return new Effect(this.id, this.trigger, this.apply, this.priority, this.condition)
  }
}

// 效果容器接口
export interface EffectContainer {
  collectEffects(trigger: EffectTrigger, baseContext: Context): void
}
