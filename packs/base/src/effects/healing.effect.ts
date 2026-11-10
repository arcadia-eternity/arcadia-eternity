import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects, targets } from '@arcadia-eternity/battle/authoring'

import { healingOnHit } from './shared-plans'

const owner = targets.ownerPet
const maxHp = owner.first().attribute('maxHp')
/** Native candidates share context lookup, target queries and action-time value reads. */
export const officialHealingEffects = defineEffects({
  effect_skill_heal_self_90_hp: healingOnHit(90),
  // Preserve the legacy floor before HealContext and OnBeforeHeal hooks.
  effect_heal_self_half: healingOnHit(maxHp.map(hp => Math.floor(hp / 2))),
  effect_heal_self_onethird: healingOnHit(maxHp.map(hp => Math.floor(hp / 3))),
  effect_skill_heal_self_quarter: healingOnHit(maxHp.map(hp => Math.floor(hp / 4))),
})

@effectGroup({ id: 'healing' })
export class HealingEffects {
  static build() {
    return officialHealingEffects
  }
}
