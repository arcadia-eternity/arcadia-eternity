import type { EffectTrigger, baseMarkId, baseSkillId, effectId, speciesId } from '@arcadia-eternity/const'
import type { Effect } from '../effect'
import type { BaseMark } from '../mark'
import type { BaseSkill } from '../skill'
import type { Species } from '../pet'

/** Resolve metadata references against the host's selected content directory. */
export interface PrototypeLookup {
  getEffect(id: effectId): Effect<EffectTrigger>
  getMark(id: baseMarkId): BaseMark
  getSkill(id: baseSkillId): BaseSkill
  getSpecies(id: speciesId): Species
}
