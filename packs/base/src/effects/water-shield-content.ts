import { Category, EffectTrigger, StackStrategy, type baseMarkId } from '@arcadia-eternity/const'
import { BaseMark } from '@arcadia-eternity/battle/engine'
import {
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  actions,
  ops,
} from '@arcadia-eternity/battle/authoring'
import { createOfficialWaterShieldCandidate } from './shield'

export function createWaterShieldDestruction(amplification: BaseMark) {
  if (amplification.id !== 'mark_shanghaizengjia')
    throw new Error('Water shield destruction requires mark_shanghaizengjia')
  return compileEffect(
    defineEffect({
      id: 'effect_mark_onDestroy_add_mark_shanghaizengjia',
      triggers: [EffectTrigger.OnMarkDestroy],
      apply: targets.ownerPet.apply(ops.addMark(amplification, { stack: 100 })),
    }),
  )
}

/** Native dependency-closed candidate. Current YAML loader acceptance remains a separate gate. */
export function createOfficialWaterShieldContent() {
  const amplify = compileEffect(
    defineEffect({
      id: 'effect_mark_amplify_next_damage_skill_power_with_stack',
      triggers: [EffectTrigger.AfterUseSkillCheck],
      when: conditions.all(
        conditions.ownerUsesSkill,
        contexts.skillUse.condition((_ctx, events) => events.some(event => event.category !== Category.Status)),
      ),
      apply: actions.choose(
        targets.sourceMark.condition(checks.exists()),
        actions.sequence(
          // Preserve the floor before adding one, including stacks below 100.
          contexts.skillUse.apply(
            ops.amplifyPower(targets.sourceMark.select(mark => Math.floor(mark.stack * 0.01) + 1).first()),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      ),
    }),
  )
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
