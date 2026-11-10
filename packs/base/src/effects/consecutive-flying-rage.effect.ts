import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { Element } from '@arcadia-eternity/const'
import {
  EffectTrigger,
  compileEffect,
  conditions,
  contexts,
  numberParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'

@effectGroup({ id: 'consecutive-flying-rage' })
export class ConsecutiveFlyingRageEffects {
  static build() {
    const rage = numberParam({ default: 20 })
    return compileEffect({
      id: 'effect_ability_add_20_rage_when_use_fly_skill_twice',
      triggers: [EffectTrigger.OnHit],
      priority: 0,
      parameters: { rage },
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_ctx, events) =>
          events.some(event => event.previousSkillElement === Element.Flying && event.element === Element.Flying),
        ),
      ),
      apply: targets.ownerPet.apply(ops.addRage(rage)),
    })
  }
}
