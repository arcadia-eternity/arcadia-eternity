import { Category, EffectTrigger, StackStrategy, type baseMarkId, type effectId } from '@arcadia-eternity/const'
import { AddMarkContext, RemoveMarkContext } from '@arcadia-eternity/battle/v4'
import { BaseMark, MarkInstanceImpl } from '@arcadia-eternity/battle/v4'
import { Pet } from '@arcadia-eternity/battle/v4'
import { defineNativeEffect } from '@arcadia-eternity/battle/v4'
import { createOfficialWaterShieldCandidate } from './shield'

export function createWaterShieldDestruction(amplification: BaseMark) {
  if (amplification.id !== 'mark_shanghaizengjia')
    throw new Error('Water shield destruction requires mark_shanghaizengjia')
  return defineNativeEffect({
    id: 'effect_mark_onDestroy_add_mark_shanghaizengjia' as effectId,
    triggers: [EffectTrigger.OnMarkDestroy],
    apply(context) {
      const target = context.source.owner
      if (target instanceof Pet) target.addMark(new AddMarkContext(context, target, amplification, 100))
    },
  })
}

/** Native dependency-closed candidate. Current YAML loader acceptance remains a separate gate. */
export function createOfficialWaterShieldContent() {
  const amplify = defineNativeEffect({
    id: 'effect_mark_amplify_next_damage_skill_power_with_stack' as effectId,
    triggers: [EffectTrigger.AfterUseSkillCheck],
    when: context => context.source.owner === context.parent.pet && context.parent.category !== Category.Status,
    apply(context) {
      if (!(context.source instanceof MarkInstanceImpl)) return
      // Preserve selector.multiply's floor before adding one, including stacks below 100.
      context.parent.amplifyPower(Math.floor(context.source.stack * 0.01) + 1)
      context.battle.removeMark(new RemoveMarkContext(context, context.source))
    },
  })
  const amplification = new BaseMark('mark_shanghaizengjia' as baseMarkId, [amplify], {
    duration: -1,
    persistent: true,
    maxStacks: 100,
    stackable: true,
    stackStrategy: StackStrategy.extend,
    destroyable: true,
    isShield: false,
    keepOnSwitchOut: true,
    transferOnSwitch: false,
    inheritOnFaint: false,
  })
  const onDestroy = createWaterShieldDestruction(amplification)
  const shield = new BaseMark(
    'mark_shuiwenpingzhang' as baseMarkId,
    [onDestroy],
    {
      duration: -1,
      persistent: true,
      maxStacks: 114514,
      stackable: true,
      stackStrategy: StackStrategy.max,
      destroyable: true,
      isShield: true,
      keepOnSwitchOut: true,
      transferOnSwitch: false,
      inheritOnFaint: false,
    },
    ['shield'],
  )
  for (const mark of [shield, amplification]) {
    Object.freeze(mark.effects)
    Object.freeze(mark.config)
    Object.freeze(mark.tags)
    Object.freeze(mark)
  }
  const application = createOfficialWaterShieldCandidate(shield)
  return Object.freeze({
    marks: Object.freeze([shield, amplification]),
    effects: Object.freeze([application.effect, onDestroy, amplify]),
    parameters: application.parameters,
    multiplier: application.multiplier,
  })
}
