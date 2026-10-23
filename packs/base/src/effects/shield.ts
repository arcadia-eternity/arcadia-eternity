import { Type } from '@sinclair/typebox'
import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { AddMarkContext } from '@arcadia-eternity/battle/v4'
import { Pet } from '@arcadia-eternity/battle/v4'
import { SkillInstance } from '@arcadia-eternity/battle/v4'
import { BaseMark, MarkInstanceImpl } from '@arcadia-eternity/battle/v4'
import { ConfigModifierType } from '@arcadia-eternity/battle/v4'
import { defineNativeEffect } from '@arcadia-eternity/battle/v4'
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
  const effect = defineNativeEffect({
    id: id as effectId,
    triggers: [EffectTrigger.OnHit],
    when(context) {
      return context.source instanceof SkillInstance
        ? context.source === context.parent.skill && context.source.owner === context.parent.pet
        : context.source instanceof MarkInstanceImpl && context.source.owner === context.parent.pet
    },
    apply(context) {
      const target = context.source.owner
      if (!(target instanceof Pet)) return
      // Each legacy selector operation floors independently, before AddMarkContext/hooks.
      const quarter = Math.floor(target.stat.maxHp / 4)
      const factor = parameters.read(context.battle.configSystem, multiplier, context.source)
      target.addMark(new AddMarkContext(context, target, mark, Math.floor(quarter * factor)))
    },
  })
  return Object.freeze({ effect, parameters, multiplier, mark })
}
