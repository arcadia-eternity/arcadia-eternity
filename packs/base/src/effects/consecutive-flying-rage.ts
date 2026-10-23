import { Element } from '@arcadia-eternity/const'
import {
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  numberParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

export function createConsecutiveFlyingRage() {
  const rage = numberParam({ default: 20 })
  return compileEffect(
    defineEffect({
      id: 'effect_ability_add_20_rage_when_use_fly_skill_twice',
      on: 'OnHit',
      priority: 0,
      parameters: { rage },
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_ctx, events) =>
          events.some(event => event.previousSkillElement === Element.Flying && event.element === Element.Flying),
        ),
      ),
      execute: targets.ownerPet.apply(ops.addRage(rage)),
    }),
  )
}
