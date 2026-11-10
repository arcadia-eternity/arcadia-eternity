import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { Type } from '@sinclair/typebox'
import { EffectTrigger, compileEffect, conditions, targets, ops, numberParam } from '@arcadia-eternity/battle/authoring'
import { ConfigModifierType } from '@arcadia-eternity/battle/engine'
import { defineParameter, parameterAddress, ParameterCatalog } from '@arcadia-eternity/battle/engine'

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
const amount = numberParam({
  default: value.value,
  legacyAddress: value.address,
  legacyAliases: value.aliases,
})
const effect = compileEffect({
  id,
  triggers: [EffectTrigger.OnHit],
  parameters: { amount },
  // Keep the threshold at collection time and read the amount when the action runs.
  when: conditions.all(
    conditions.selfUsesSkill,
    targets.selfPlayer.condition((_ctx, players) => players.some(player => player.currentRage < 40)),
  ),
  apply: targets.ownerPet.apply(ops.addRage(amount)),
})

/** Explicit candidate only. Install parameters before use; aliases resolve through this catalog. */
export const officialRageCandidate = Object.freeze({ effect, parameters, value })

@effectGroup({ id: 'rage' })
export class RageEffects {
  static build() {
    return {
      effects: { [officialRageCandidate.effect.id]: officialRageCandidate.effect },
      parameters: officialRageCandidate.parameters,
    }
  }
}
