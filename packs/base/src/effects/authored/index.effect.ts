import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects } from '@arcadia-eternity/battle/authoring'
import { consumeFantasyForDefense } from './fantasy-defense'
import { damageBoostByHp } from './damage-by-hp'
import { timeRebirth } from './time-rebirth'
import { weaknessSpeedPenalty } from './weakness-speed'

/** Explicit candidate set. Catalog acceptance and persistent-plan restoration remain separate gates. */
@effectGroup({ id: 'authored' })
export class AuthoredEffects {
  static build() {
    return defineEffects({
      [consumeFantasyForDefense.id]: consumeFantasyForDefense,
      [damageBoostByHp.id]: damageBoostByHp,
      [timeRebirth.id]: timeRebirth,
      [weaknessSpeedPenalty.id]: weaknessSpeedPenalty,
    })
  }
}

export const officialAuthoredEffects = AuthoredEffects.build()
