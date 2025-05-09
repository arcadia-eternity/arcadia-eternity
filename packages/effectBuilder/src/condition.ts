import {
  AddMarkContext,
  BaseStatLevelMark,
  DamageContext,
  EffectContext,
  HealContext,
  MarkInstanceImpl,
  Pet,
  RageContext,
  SkillInstance,
  UseSkillContext,
} from '@arcadia-eternity/battle'
import type { Condition, ValueSource } from './effectBuilder'
import { ContinuousUseSkillStrategy, StatTypeWithoutHp } from '@arcadia-eternity/const'
import { GetValueFromSource } from './operator'

export const Conditions = {
  some: (...conditions: Condition[]): Condition => {
    return context => {
      return conditions.some(condition => condition(context))
    }
  },
  every: (...conditions: Condition[]): Condition => {
    return context => {
      return conditions.every(condition => condition(context))
    }
  },
  not: (condition: Condition): Condition => {
    return context => {
      return !condition(context)
    }
  },

  petIsActive: (): Condition => {
    return context => {
      if (context.source.owner instanceof Pet) {
        return context.source.owner.isActive()
      }
      return false
    }
  },

  //用于技能，检查正在使用的技能是否是自身，仅当使用的技能是自身时生效
  selfUseSkill: (): Condition => {
    return context => {
      if (context.parent instanceof UseSkillContext && context.source instanceof SkillInstance) {
        return context.source === context.parent.skill
      }
      if (context.parent instanceof UseSkillContext && context.source instanceof MarkInstanceImpl) {
        return context.source.owner === context.parent.pet
      }
      if (
        context.parent instanceof DamageContext &&
        context.parent.parent instanceof UseSkillContext &&
        context.source instanceof SkillInstance
      ) {
        //该效果的拥有者技能的拥有者(精灵/全局)是使用技能造成伤害的宠物 并且 当前使用的技能是该技能
        return context.source.owner === context.parent.source && context.source === context.parent.parent.skill
      }
      if (
        context.parent instanceof DamageContext &&
        context.parent.parent instanceof UseSkillContext &&
        context.source instanceof MarkInstanceImpl
      ) {
        //该效果的拥有者技能的拥有者(精灵/全局)是使用技能造成伤害的宠物
        return context.source.owner === context.parent.source
      }
      return false
    }
  },

  checkSelf: (): Condition => {
    return context => {
      if (context.parent instanceof UseSkillContext) {
        return context.source.owner === context.parent.pet
      }
      if (context.parent instanceof DamageContext) {
        return context.source.owner === context.parent.target
      }
      if (
        context.parent instanceof RageContext &&
        context.parent.reason === 'damage' &&
        context.parent.parent instanceof UseSkillContext &&
        context.source.owner instanceof Pet
      ) {
        return context.source.owner.owner === context.parent.target
      }
      if (context.parent instanceof HealContext) {
        return context.source.owner === context.parent.target
      }
      if (context.parent instanceof EffectContext) {
        return context.source.owner === context.parent.source.owner
      }
      return false
    }
  },

  foeUseSkill: (): Condition => {
    return context => {
      if (context.parent instanceof UseSkillContext) {
        return context.source.owner !== context.parent.pet
      }
      return false
    }
  },

  selfBeDamaged: (): Condition => {
    return context => {
      if (context.parent instanceof DamageContext) {
        return context.source.owner === context.parent.target
      }
      if (
        context.parent instanceof RageContext &&
        context.parent.reason === 'damage' &&
        context.parent.parent instanceof UseSkillContext &&
        context.source.owner instanceof Pet
      ) {
        return context.source.owner === context.parent.target.activePet
      }
      return false
    }
  },

  selfAddMark: (): Condition => {
    return context => {
      if (context.parent instanceof AddMarkContext) {
        return context.source.owner === context.parent.parent.source.owner
      }
      return false
    }
  },

  foeAddMark: (): Condition => {
    return context => {
      if (
        context.parent instanceof AddMarkContext &&
        context.source.owner instanceof Pet &&
        context.parent.parent.source.owner instanceof Pet
      ) {
        return context.source.owner !== context.parent.parent.source.owner
      }
      return false
    }
  },

  //自己被添加印记时
  selfBeAddMark: (): Condition => {
    return context => {
      if (context.parent instanceof AddMarkContext) {
        return context.source.owner === context.parent.target
      }
      return false
    }
  },

  //对方被添加印记时
  foeBeAddMark: (): Condition => {
    return context => {
      if (
        context.parent instanceof AddMarkContext &&
        context.source.owner instanceof Pet &&
        context.parent.target instanceof Pet
      ) {
        return context.source.owner !== context.parent.target
      }
      return false
    }
  },

  selfBeHeal: (): Condition => {
    return context => {
      if (context.parent instanceof HealContext) {
        return context.source.owner === context.parent.target
      }
      return false
    }
  },

  continuousUseSkill: (
    times: ValueSource<number>,
    strategy: ContinuousUseSkillStrategy = ContinuousUseSkillStrategy.Continuous,
  ): Condition => {
    switch (strategy) {
      case ContinuousUseSkillStrategy.Periodic:
        return context => {
          const _times = GetValueFromSource(context, times)
          if (_times.length === 0) return false
          if (context.parent instanceof UseSkillContext) {
            return (
              context.source.owner === context.parent.pet &&
              (context.parent.skill.owner?.lastSkillUsedTimes ?? 0) % _times[0] === 0
            )
          }
          return false
        }
      case ContinuousUseSkillStrategy.Once:
        return context => {
          const _times = GetValueFromSource(context, times)
          if (_times.length === 0) return false
          if (context.parent instanceof UseSkillContext) {
            return (
              context.source.owner === context.parent.pet &&
              (context.parent.skill.owner?.lastSkillUsedTimes ?? 0) === _times[0]
            )
          }
          return false
        }
      case ContinuousUseSkillStrategy.Continuous:
        return context => {
          const _times = GetValueFromSource(context, times)
          if (_times.length === 0) return false
          if (context.parent instanceof UseSkillContext) {
            return (
              context.source.owner === context.parent.pet &&
              (context.parent.skill.owner?.lastSkillUsedTimes ?? 0) >= _times[0]
            )
          }
          return false
        }
    }
  },

  statStageChange: (
    stat: ValueSource<StatTypeWithoutHp> = [
      StatTypeWithoutHp.atk,
      StatTypeWithoutHp.def,
      StatTypeWithoutHp.spa,
      StatTypeWithoutHp.spd,
      StatTypeWithoutHp.spe,
    ],
    check: 'up' | 'down' | 'all' = 'all',
  ): Condition => {
    return context => {
      if (context.parent instanceof AddMarkContext) {
        const mark = context.parent.baseMark
        const _stat = GetValueFromSource(context, stat)
        if (_stat.length === 0) return false
        if (mark instanceof BaseStatLevelMark && _stat.includes(mark.statType) && mark.initialLevel !== 0) {
          switch (check) {
            case 'up':
              return mark.initialLevel > 0
            case 'down':
              return mark.initialLevel < 0
            case 'all':
              return true
            default:
              return false
          }
        }
      }
      return false
    }
  },
}
