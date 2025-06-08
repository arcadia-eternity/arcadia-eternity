import {
  AddMarkContext,
  BaseStatLevelMark,
  Battle,
  Context,
  DamageContext,
  EffectContext,
  HealContext,
  MarkInstanceImpl,
  Pet,
  RageContext,
  SkillInstance,
  SwitchPetContext,
  TurnContext,
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

  //当当前回合使用了该技能时，返回True
  currentRoundUseSkill: (): Condition => {
    return context => {
      if (context.parent instanceof TurnContext) {
        return context.parent.contexts.some(ctx => {
          if (!(ctx instanceof UseSkillContext)) return false
          return ctx.skill === context.source
        })
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
      if (context.parent instanceof SwitchPetContext) {
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

  foeBeDamaged: (): Condition => {
    return context => {
      // Find the nearest DamageContext in the context chain
      let currentCtx: Context = context
      while (!(currentCtx instanceof Battle)) {
        if (currentCtx instanceof DamageContext) {
          // Found a DamageContext, check if the damaged target is a foe
          if (context.source.owner instanceof Pet) {
            const sourceOwner = context.source.owner.owner! // Player who owns the effect source
            const targetOwner = currentCtx.target.owner! // Player who owns the damaged pet
            return sourceOwner !== targetOwner // Different players = foe
          }
          return false
        }
        if (!currentCtx.parent) break
        currentCtx = currentCtx.parent
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

  selfSwitchIn: (): Condition => {
    return context => {
      if (context.parent instanceof SwitchPetContext) {
        return context.source.owner === context.parent.target
      }
      return false
    }
  },

  selfSwitchOut: (): Condition => {
    return context => {
      if (context.parent instanceof SwitchPetContext) {
        return context.source.owner === context.parent.origin.activePet
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

  // 精灵当回合使用技能且该技能为本回合最先使用的技能时
  isFirstSkillUsedThisTurn: (): Condition => {
    return context => {
      console.debug('emm1')
      if (!(context.parent instanceof UseSkillContext)) {
        return false
      }
      const currentUseSkillContext = context.parent
      if (!(currentUseSkillContext.parent instanceof TurnContext)) {
        return false
      }
      const turnContext = currentUseSkillContext.parent

      const executedSkillContextsInOrder = turnContext.appledContexts.filter(
        (ctx): ctx is UseSkillContext => ctx instanceof UseSkillContext,
      )

      console.debug(executedSkillContextsInOrder)
      if (executedSkillContextsInOrder.length === 0) {
        return false // 理论上不应发生，因为当前就在一个UseSkillContext中
      }

      console.debug(executedSkillContextsInOrder[0], currentUseSkillContext)
      console.debug(executedSkillContextsInOrder[0] === currentUseSkillContext)
      return executedSkillContextsInOrder[0] === currentUseSkillContext
    }
  },

  // 精灵当回合使用技能且该技能为本回合（到目前为止）最后使用的技能时
  isLastSkillUsedThisTurn: (): Condition => {
    return context => {
      if (!(context.parent instanceof UseSkillContext)) {
        return false
      }
      const currentUseSkillContext = context.parent
      if (!(currentUseSkillContext.parent instanceof TurnContext)) {
        return false
      }
      const turnContext = currentUseSkillContext.parent

      const plannedSkillContextsThisTurn = turnContext.contexts.filter(
        (ctx): ctx is UseSkillContext => ctx instanceof UseSkillContext,
      )

      if (plannedSkillContextsThisTurn.length === 0) {
        return false // 没有计划的技能
      }

      // 由于 contextQueue.pop() 从尾部取，turnContext.contexts[0] 是计划中最后执行的技能
      return plannedSkillContextsThisTurn[0] === currentUseSkillContext
    }
  },

  // 当自己被选为当前UseSkillContext的目标时返回true
  selfBeSkillTarget: (): Condition => {
    return context => {
      if (context.parent instanceof UseSkillContext) {
        return context.source.owner === context.parent.actualTarget
      }
      return false
    }
  },
}
