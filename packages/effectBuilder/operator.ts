import { EffectTrigger } from 'packages/core/effect'
import {
  EffectContext,
  UseSkillContext,
  DamageContext,
  HealContext,
  AddMarkContext,
  RageContext,
} from 'packages/core/context'
import { Mark } from 'packages/core/mark'
import { Pet } from 'packages/core/pet'
import { Player } from 'packages/core/player'
import { type SelectorOpinion, type ValueSource, ChainableSelector, GetValueFromSource } from './selector'
import { MarkOwner, StatTypeOnBattle, StatTypeWithoutHp } from 'packages/core/const'
import { Operator } from './effectBuilder'
import { Battle } from 'packages/core/battle'

function createDynamicOperator<T extends SelectorOpinion, U extends SelectorOpinion>(
  handler: (value: U[], target: T, context: EffectContext<EffectTrigger>) => void,
) {
  return (source: ValueSource<U>) => {
    return (context: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(target => {
        let finalValue: U[] = []

        if (typeof source === 'function') {
          try {
            finalValue = (source as (context: EffectContext<EffectTrigger>) => U[])(context)
          } catch {
            finalValue = []
          }
        } else if (source instanceof ChainableSelector) {
          finalValue = source.build()(context)
        } else {
          finalValue = [source]
        }

        if (finalValue.length != 0) {
          return handler(finalValue, target, context)
        }
      })
    }
  }
}
// 操作符系统

export const Operators = {
  dealDamage: createDynamicOperator<Pet, number>((value, pet, context) => {
    let source
    if (context.parent instanceof UseSkillContext) source = context.parent.pet
    else source = context.source
    pet.damage(new DamageContext(context, source, value[0]))
  }),

  heal: createDynamicOperator<Pet, number>((value, pet, context) => {
    pet.heal(new HealContext(context, context.source, value[0]))
  }),

  addMark:
    <T extends MarkOwner>(mark: Mark, stack: number) =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(target => {
        target.addMark(new AddMarkContext(context, target, mark, stack))
      })
    },

  transferMark:
    <T extends Battle | Pet, U extends Mark>(mark: ValueSource<U>) =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      const _mark = GetValueFromSource(context, mark)
      _mark.forEach(m => {
        m.transfer(context, targets[0])
      })
    },

  addStack:
    <T extends Mark>(markid: string, value: number) =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.filter(mark => mark.id == markid).forEach(mark => mark.addStack(value))
    },

  consumeStacks:
    <T extends Mark>(markid: string, value: number) =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.filter(mark => mark.id == markid).forEach(mark => mark.consumeStack(context, value))
    },

  // 玩家操作
  addRage: createDynamicOperator<Player, number>((value, player, context) => {
    player.addRage(new RageContext(context, player, 'effect', 'add', value[0]))
  }),

  modifyStat:
    (stat: ValueSource<StatTypeOnBattle>, percent: ValueSource<number>, value: ValueSource<number>) =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach(pet => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _percent = GetValueFromSource(context, percent)[0] ?? 0
        const _value = GetValueFromSource(context, value)[0] ?? 0
        pet.statModifiers[_stat][0] += _percent
        pet.statModifiers[_stat][1] += _value
      })
    },

  amplifyPower:
    (multiplier: ValueSource<number>): Operator<UseSkillContext> =>
    (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const finalMultiplier = GetValueFromSource(context, multiplier)
        finalMultiplier.forEach(v => skillCtx.amplifyPower(v))
      })
    },

  addPower: (value: ValueSource<number>) => (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
    contexts.forEach(skillCtx => {
      const _value = GetValueFromSource(context, value)
      _value.forEach(v => skillCtx.addPower(v))
    })
  },

  statStageBuff:
    (statType: ValueSource<StatTypeWithoutHp>, value: ValueSource<number>) =>
    (context: EffectContext<EffectTrigger>, target: Pet[]) => {
      //TODO: 万一找不到呢？
      const _value = GetValueFromSource(context, value)[0] ?? 0
      const _statType = GetValueFromSource(context, statType)[0] ?? null
      target.forEach(v => v.addStatStage(context, _statType, _value))
    },
}
