import { BattleSystem, Player, UseSkillContext } from './battleSystem'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'

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
export interface EffectContext {
  battle: BattleSystem
  source: UseSkillContext | Mark
  owner: Pet
}

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
class ChainableSelector<T> {
  constructor(private selector: TargetSelector<T>) {}

  // 类型转换核心方法
  select<U>(extractor: ValueExtractor<T, U>): ChainableSelector<U> {
    return new ChainableSelector<U>(context => {
      return this.selector(context).flatMap(target => {
        const result = extractor(target)
        return Array.isArray(result) ? result : [result]
      })
    })
  }

  // 保留原有链式方法（带泛型约束）
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
function createChainable<T>(selector: TargetSelector<T>): ChainableSelector<T> {
  return new ChainableSelector(selector)
}

// 基础选择器
export const Selectors = {
  self: createChainable((context: EffectContext) => [context.owner]),
  opponentActive: createChainable((context: EffectContext) => [(context.source as UseSkillContext).actualTarget!]),
  petOwners: createChainable((context: EffectContext) => [context.owner.owner!]),
  usingSkillContext: createChainable((context: EffectContext) => [context.source as UseSkillContext]),
} satisfies Record<string, ChainableSelector<SelectorOpinion>>

// 提取器
export const Extractors = {
  owner: (pet: Pet) => pet.owner,
  skills: (pet: Pet | null) => (pet ? pet.skills : []),
  usingSkill: (pet: Pet | null) => {}, //TODO: return useskillcontext
  activePet: (player: Player | null) => player?.activePet ?? null,

  hp: (target: Pet) => target.currentHp,
  rage: (target: Player) => target.currentRage,
  marks: (target: Pet | null) => (target ? target.marks : []),

  stack: (target: Mark | null) => target?.stacks,
  duration: (target: Mark | null) => target?.duration,

  //skill
  power: (target: UseSkillContext) => target.power,
  priority: (target: UseSkillContext) => target.skillPriority,
}

const complexSelector = Selectors.opponentActive
  .select(Extractors.owner) // 从Pet转换到Player
  .where(player => player?.currentRage > 50) // 过滤怒气值
  .select(Extractors.activePet) // 从Player转换到Pet
  .where(pet => pet?.currentHp < 30) // 过滤血量
  .where(() => Math.random() < 0.5) //随机
  .select(Extractors.skills) // 从Pet转换到Skill[]
  .build()

export type SelectorOpinion = Player | Pet | Mark | Skill | UseSkillContext

export const ConditionOperator = {}
