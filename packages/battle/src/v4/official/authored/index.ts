import { compileEffect } from '../../content/authoring'
import { consumeFantasyForDefense } from './fantasy-defense'
import { damageBoostByHp } from './damage-by-hp'
import { timeRebirth } from './time-rebirth'
import { weaknessSpeedPenalty } from './weakness-speed'

/** Explicit candidate set. Catalog acceptance and persistent-plan restoration remain separate gates. */
export function createOfficialAuthoredEffects() {
  return Object.freeze({
    effect_skill_consume_huanxiang_raise_def_1_stage: compileEffect(consumeFantasyForDefense),
    effect_mark_damage_boost_based_on_hp_percentage: compileEffect(damageBoostByHp),
    effect_mark_shiguangchongsheng: compileEffect(timeRebirth),
    effect_mark_reduce_speed_ruodian: compileEffect(weaknessSpeedPenalty),
  })
}

export const officialAuthoredEffects = createOfficialAuthoredEffects()
