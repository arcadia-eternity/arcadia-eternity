import { Type } from '@sinclair/typebox'
import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { RageContext } from '@arcadia-eternity/battle/v4'
import { Pet } from '@arcadia-eternity/battle/v4'
import { SkillInstance } from '@arcadia-eternity/battle/v4'
import { MarkInstanceImpl } from '@arcadia-eternity/battle/v4'
import { ConfigModifierType } from '@arcadia-eternity/battle/v4'
import { defineNativeEffect } from '@arcadia-eternity/battle/v4'
import { defineParameter, parameterAddress, ParameterCatalog } from '@arcadia-eternity/battle/v4'

const id = 'effect_skill_add_rage_20_if_rage_below_40'
const value = defineParameter({
  address: parameterAddress(id, 'add-rage', 'value'),
  schema: Type.Number({ default: 20 }),
  effectiveSchema: Type.Number(),
  value: 20,
  operations: [ConfigModifierType.delta, ConfigModifierType.override],
  aliases: [`${id}.add_rage_value`],
})
const parameters = new ParameterCatalog([value])
const effect = defineNativeEffect({
  id: id as effectId,
  triggers: [EffectTrigger.OnHit],
  when(context) {
    const source = context.source
    const selfUsesSkill =
      source instanceof SkillInstance
        ? source === context.parent.skill && source.owner === context.parent.pet
        : source instanceof MarkInstanceImpl && source.owner === context.parent.pet
    // selfPlayer selects the skill context's pet owner; the threshold is collect-time.
    return selfUsesSkill && context.parent.pet.owner!.currentRage < 40
  },
  apply(context) {
    const target = context.source.owner
    const amount = parameters.read(context.battle.configSystem, value, context.source)
    if (target instanceof Pet && target.owner)
      target.addRage(new RageContext(context, target.owner, 'effect', 'add', amount))
  },
})

/** Explicit candidate only. Install parameters before use; aliases resolve through this catalog. */
export const officialRageCandidate = Object.freeze({ effect, parameters, value })
