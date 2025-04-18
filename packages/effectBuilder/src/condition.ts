import {
  AddMarkContext,
  DamageContext,
  HealContext,
  Pet,
  RageContext,
  SkillInstance,
  UseSkillContext,
} from '@arcadia-eternity/battle'
import type { Condition } from './effectBuilder'

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
      if (context.parent instanceof DamageContext && context.parent.parent instanceof UseSkillContext) {
        return context.source.owner === context.parent.source && context.source === context.parent.parent.skill
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
}
