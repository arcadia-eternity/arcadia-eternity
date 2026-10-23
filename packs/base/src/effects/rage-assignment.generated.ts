// Reviewed native behavior; edit this TypeScript source directly.
import {
  compileEffect,
  defineEffect,
  conditions,
  targets,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedRageAssignment() {
  return Object.freeze({
    effect_ability_keep_rage_at_least_25: compileEffect(
      defineEffect({
        id: 'effect_ability_keep_rage_at_least_25',
        on: ['OnRageGain', 'OnRageLoss', 'OnBattleStart'],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, (ctx: EffectFrame) => {
          const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
          const right = 25
          return left !== undefined && right !== undefined && left < right
        }),
        execute: actions.sequence(targets.ownerPet.apply(ops.setRage(25))),
      }),
    ),
    effect_mark_clear_rage_on_switch_out: compileEffect(
      defineEffect({
        id: 'effect_mark_clear_rage_on_switch_out',
        on: 'OnSwitchOut',
        priority: 0,
        when: conditions.ownerSwitchesOut,
        execute: actions.sequence(targets.ownerPet.apply(ops.setRage(0))),
      }),
    ),
    effect_mark_clear_rage_on_turn_start: compileEffect(
      defineEffect({
        id: 'effect_mark_clear_rage_on_turn_start',
        on: 'TurnStart',
        priority: 0,
        when: conditions.ownerIsActive,
        execute: actions.sequence(targets.ownerPet.apply(ops.setRage(0))),
      }),
    ),
    effect_skill_set_opponent_rage_to_self: compileEffect(
      defineEffect({
        id: 'effect_skill_set_opponent_rage_to_self',
        on: 'OnHit',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          targets.opponentActive.apply(ops.setRage(targets.selfPlayer.select(player => player.currentRage).first())),
        ),
      }),
    ),
  })
}
export const generatedRageAssignment = createGeneratedRageAssignment()
