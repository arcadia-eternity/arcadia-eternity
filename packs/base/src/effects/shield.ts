import { Type } from '@sinclair/typebox'
import { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  targets,
  values,
  ops,
  numberParam,
} from '@arcadia-eternity/battle/v4/authoring'
import { ConfigModifierType } from '@arcadia-eternity/battle/v4'
import { defineParameter, parameterAddress, ParameterCatalog } from '@arcadia-eternity/battle/v4'

const id = 'effect_skill_add_mark_shuiwenpingzhang'
/** Dependency supplied by the trusted catalog; this factory never substitutes a missing mark. */
export function createOfficialWaterShieldCandidate(mark: BaseMark) {
  if (!(mark instanceof BaseMark) || mark.id !== 'mark_shuiwenpingzhang')
    throw new Error('Water shield candidate requires mark_shuiwenpingzhang content')
  const multiplier = defineParameter({
    address: parameterAddress(id, 'shield-stack', 'multiplier'),
    schema: Type.Number({ default: 1 }),
    effectiveSchema: Type.Number(),
    value: 1,
    operations: [ConfigModifierType.delta, ConfigModifierType.override],
    aliases: [`${id}.multiply_value`],
  })
  const parameters = new ParameterCatalog([multiplier])
  const factor = numberParam({
    default: multiplier.value,
    legacyAddress: multiplier.address,
    legacyAliases: multiplier.aliases,
  })
  // Keep both legacy rounding steps, before mark-application hooks.
  const quarter = targets.ownerPet.select(pet => Math.floor(pet.stat.maxHp / 4)).first()
  const stack = values.combine(quarter, factor, (hp, multiple) => Math.floor(hp * multiple))
  const effect = compileEffect(
    defineEffect({
      id,
      triggers: [EffectTrigger.OnHit],
      parameters: { factor },
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addMark(mark, { stack })),
    }),
  )
  return Object.freeze({ effect, parameters, multiplier, mark })
}
