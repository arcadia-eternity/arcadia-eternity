import { defineEffects } from '@arcadia-eternity/battle/authoring'
import { consumeFantasyForDefense } from './fantasy-defense'
import { damageBoostByHp } from './damage-by-hp'
import { timeRebirth } from './time-rebirth'
import { weaknessSpeedPenalty } from './weakness-speed'

/** Explicit candidate set. Catalog acceptance and persistent-plan restoration remain separate gates. */
export function createOfficialAuthoredEffects() {
  return defineEffects({
    [consumeFantasyForDefense.id]: consumeFantasyForDefense,
    [damageBoostByHp.id]: damageBoostByHp,
    [timeRebirth.id]: timeRebirth,
    [weaknessSpeedPenalty.id]: weaknessSpeedPenalty,
  })
}

export const officialAuthoredEffects = createOfficialAuthoredEffects()
