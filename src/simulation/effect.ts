// effect.ts
import { BattleSystem, UseSkillContext } from './battleSystem'
import { Mark } from './mark'

// 统一效果触发阶段
export enum EffectTrigger {
  // 技能相关
  SkillPreDamage = 'SKILL_PRE_DAMAGE',
  SkillPostDamage = 'SKILL_POST_DAMAGE',
  SkillOnHit = 'SKILL_ON_HIT',
  SkillOnMiss = 'SKILL_ON_MISS',
  SkillOnCritPreDamage = 'SKILL_ON_CRIT_PRE_DAMAGE',
  SkillOnCritPostDamage = 'SKILL_ON_CRIT_POST_DAMAGE',

  // 印记相关
  MarkTurnStart = 'MARK_TURN_START',
  MarkTurnEnd = 'MARK_TURN_END',
  MarkBeforeAttack = 'MARK_BEFORE_ATTACK',
  MarkAfterAttacked = 'MARK_AFTER_ATTACKED',
  MarkOnStack = 'MARK_ON_STACK',

  // 通用
  OnHeal = 'ON_HEAL',
  OnSwitch = 'ON_SWITCH',
  OnDefeat = 'ON_DEFEAT',
}

// 效果上下文
export interface EffectContext {
  battle: BattleSystem
  source: UseSkillContext | Mark
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
