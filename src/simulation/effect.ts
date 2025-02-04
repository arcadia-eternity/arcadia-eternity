import { Player } from './battleSystem'
import { StatOnBattle } from './const'
import { EffectContext, UseSkillContext } from './context'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'
import { Type } from './type'

// 统一效果触发阶段
export enum EffectTrigger {
  OnBattleStart = 'ON_BATTLE_START',
  PreDamage = 'PRE_DAMAGE',
  PostDamage = 'POST_DAMAGE',
  OnHit = 'ON_HIT',
  OnMiss = 'ON_MISS',
  OnCritPreDamage = 'ON_CRIT_PRE_DAMAGE',
  OnCritPostDamage = 'ON_CRIT_POST_DAMAGE',

  // 印记相关
  TurnStart = 'TURN_START',
  TurnEnd = 'TURN_END',
  BeforeAttack = 'BEFORE_ATTACK',
  AfterAttacked = 'AFTER_ATTACKED',

  OnStack = 'ON_STACK',

  // 通用
  OnHeal = 'ON_HEAL',
  OnSwitchIn = 'ON_SWITCH_IN',
  OnSwitchOut = 'ON_SWITCH_OUT',
  OnDefeat = 'ON_DEFEAT',
}

// 效果上下文

// 基础效果接口
export interface Effect {
  id: string
  trigger: EffectTrigger
  condition?: (ctx: EffectContext) => boolean
  apply: (ctx: EffectContext) => void
  meta?: {
    stackable?: boolean
    maxStacks?: number
    duration?: number
    persistent?: boolean
  }
}

// 效果容器接口
export interface EffectContainer {
  getEffects(trigger: EffectTrigger): Effect[]
}

// 效果应用器
export class EffectApplicator {
  static apply(container: EffectContainer, trigger: EffectTrigger, context: EffectContext) {
    const effects = container.getEffects(trigger)
    effects.forEach(effect => {
      if (!effect.condition || effect.condition(context)) {
        effect.apply(context)
      }
    })
  }
}
// 条件系统分为三个层级
// 修改选择器类型定义
export type TargetSelector<T> = (context: EffectContext) => T[]
export type ChainableTargetSelector<T> = TargetSelector<T> & {
  where: (predicate: (target: T, context: EffectContext) => boolean) => ChainableTargetSelector<T>
  and: (other: TargetSelector<T>) => ChainableTargetSelector<T>
  or: (other: TargetSelector<T>) => ChainableTargetSelector<T>
}
export type ConditionOperator<U> = (values: U[]) => boolean // 判断逻辑
export type ValueExtractor<T, U> = (target: T) => U | U[]

// 重构链式选择器类（支持类型转换）
class ChainableSelector<T extends SelectorOpinion> {
  constructor(private selector: TargetSelector<T>) {}

  select<U extends SelectorOpinion>(extractor: ValueExtractor<T, U>): ChainableSelector<U> {
    return new ChainableSelector<U>(context =>
      this.selector(context).flatMap(target => {
        const result = extractor(target)
        return Array.isArray(result) ? result : [result]
      }),
    )
  }

  where(predicate: (target: T, context: EffectContext) => boolean): ChainableSelector<T> {
    return new ChainableSelector(context => {
      return this.selector(context).filter(t => predicate(t, context))
    })
  }

  and(other: TargetSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      return prev.filter(t => otherResults.includes(t))
    })
  }

  or(other: TargetSelector<T>): ChainableSelector<T> {
    return new ChainableSelector(context => {
      const prev = this.selector(context)
      const otherResults = other(context)
      return [...new Set([...prev, ...otherResults])]
    })
  }

  // 最终构建方法
  build(): TargetSelector<T> {
    return this.selector
  }
}

// 类型增强装饰器
function createChainable<T extends SelectorOpinion>(selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector)
}

export type SelectorOpinion = Player | Pet | Mark | Skill | UseSkillContext | StatOnBattle

// 基础选择器
export const BaseSelectors: {
  self: ChainableSelector<Pet>
  opponentActive: ChainableSelector<Pet>
  petOwners: ChainableSelector<Player>
  usingSkillContext: ChainableSelector<UseSkillContext>
} = {
  self: createChainable<Pet>((context: EffectContext) => [context.owner]),
  opponentActive: createChainable<Pet>((context: EffectContext) => [(context.source as UseSkillContext).actualTarget!]),
  petOwners: createChainable<Player>((context: EffectContext) => [context.owner.owner!]),
  usingSkillContext: createChainable<UseSkillContext>((context: EffectContext) => [context.source as UseSkillContext]),
}

type ExtractorsMap = {
  hp: (target: Pet) => number
  rage: (target: Player) => number
  owner: (target: Pet) => Player
  type: (target: Pet) => Type
  marks: (target: Pet) => Mark[]
  stats: (target: Pet) => StatOnBattle
  stack: (target: Mark) => number
  duration: (target: Mark) => number
  power: (target: UseSkillContext) => number
  priority: (target: UseSkillContext) => number
  activePet: (target: Player) => Pet
  skills: (target: Pet) => Skill[]
}

// 实现提取函数
export const Extractors: ExtractorsMap = {
  hp: (target: Pet) => target.currentHp,
  rage: (target: Player) => target.currentRage,
  owner: (target: Pet) => target.owner!,
  type: (target: Pet) => target.type,
  marks: (target: Pet) => target.marks,
  stats: (target: Pet) => target.stat,
  stack: (target: Mark) => target.stacks,
  duration: (target: Mark) => target.duration,
  power: (target: UseSkillContext) => target.power,
  priority: (target: UseSkillContext) => target.skillPriority,
  activePet: (target: Player) => target.activePet,
  skills: (target: Pet) => target.skills,
}

export const Conditioner = {
  // number
  up: (value: number) => (targets: number[]) => targets.some(target => target > value),
  down: (value: number) => (targets: number[]) => targets.some(target => target < value),
  equal: (value: number) => (targets: number[]) => targets.some(target => target == value),
  upEqual: (value: number) => (targets: number[]) => targets.some(target => target >= value),
  downEqual: (value: number) => (targets: number[]) => targets.some(target => target <= value),
  notEqual: (value: number) => (targets: number[]) => targets.some(target => target != value),
  between: (min: number, max: number) => (targets: number[]) => targets.some(target => target >= min && target <= max),

  // marks
  hasMark: (markid: string) => (marks: Mark[]) => marks.some(v => v.id == markid),
}

export class ConditionFactory {
  static CreateCondition<T>(
    selector: TargetSelector<T>,
    conditioner: ConditionOperator<T>,
  ): (ctx: EffectContext) => boolean {
    return (ctx: EffectContext) => conditioner(selector(ctx))
  }
}

// const complexSelector = BaseSelectors.opponentActive
//   .select(Extractors.owner) // 从Pet转换到Player
//   .where(player => player?.currentRage > 50) // 过滤怒气值
//   .select(Extractors.activePet) // 从Player转换到Pet
//   .where(pet => pet?.currentHp < 30) // 过滤血量
//   .where(() => Math.random() < 0.5) //随机
//   .select(Extractors.skills) // 从Pet转换到Skill[]
//   .where(() => true)
//   .build()
