// Reviewed native behavior; edit this TypeScript source directly.
import {
  compileEffect,
  defineEffect,
  conditions,
  targets,
  checks,
  ops,
  actions,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedMarkConsumption() {
  return Object.freeze({
    effect_skill_consume_all_kongqichuliang: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_all_kongqichuliang',
        on: 'OnHit',
        priority: -50,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').condition(checks.exists()),
        ),
        execute: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').apply(ops.consumeStacks(100)),
        ),
      }),
    ),
    effect_skill_consume_all_opponent_manxingduyao: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_all_opponent_manxingduyao',
        on: 'OnHit',
        priority: -50,
        when: () => true,
        execute: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_manxingduyao').apply(ops.consumeStacks(10)),
        ),
      }),
    ),
    effect_skill_consume_all_zengzhong: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_all_zengzhong',
        on: 'OnHit',
        priority: -50,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zengzhong').apply(ops.consumeStacks(2)),
        ),
      }),
    ),
    effect_skill_consume_all_zhongzinengliang: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_all_zhongzinengliang',
        on: 'OnHit',
        priority: -50,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zhongzinengliang').apply(ops.consumeStacks(4)),
        ),
      }),
    ),
    effect_skill_consume_ruodian: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_ruodian',
        on: 'OnHit',
        priority: -50,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_ruodianjihao').apply(ops.consumeStacks(2)),
        ),
      }),
    ),
    effect_skill_consume_shuiwenzhenji: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_shuiwenzhenji',
        on: 'OnHit',
        priority: -50,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiwenzhenji').condition(checks.exists()),
        ),
        execute: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiwenzhenji').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
    effect_skill_consume_xinzhiyinji_multihit_consume: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_xinzhiyinji_multihit_consume',
        on: 'OnHit',
        priority: -50,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_xinzhiyinji')),
          ),
        ),
        execute: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_xinzhiyinji').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
  })
}
export const generatedMarkConsumption = createGeneratedMarkConsumption()
