import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
// Reviewed native behavior; edit this TypeScript source directly.
import { defineEffects, EffectTrigger, conditions, contexts, ops, actions } from '@arcadia-eternity/battle/authoring'
import { ownerHasMark } from './mark-queries'
@effectGroup({ id: 'ignore-shield.generated' })
export class IgnoreShieldGeneratedEffects {
  static build() {
    return defineEffects({
      effect_skill_ignore_opponent_shield_if_has_shunliu: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, ownerHasMark('mark_shunliu')),
        apply: actions.sequence(contexts.skillUse.apply(ops.setIgnoreShield())),
      },
    })
  }
}

export const generatedIgnoreShield = IgnoreShieldGeneratedEffects.build()
