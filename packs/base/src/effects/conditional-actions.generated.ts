// Reviewed native behavior; edit this TypeScript source directly.
import { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  selectFrom,
  numberParam,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export const generatedConditionalActionDependencies = Object.freeze([
  'mark_dingshizhadan',
  'mark_mabi',
  'mark_shandianluoyin',
  'mark_shaoshang',
  'mark_shijianzhadan',
  'mark_shuimian',
])
export function createGeneratedConditionalActions(marks: ReadonlyMap<string, BaseMark>) {
  const resolved = new Map<string, BaseMark>()
  for (const id of generatedConditionalActionDependencies) {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id)
      throw new Error('Missing or mismatched native mark dependency: ' + id)
    resolved.set(id, mark)
  }
  return Object.freeze({
    effect_increase_damage_taken_once_50_percent_double_effect_if_frozen: compileEffect(
      defineEffect({
        id: 'effect_increase_damage_taken_once_50_percent_double_effect_if_frozen',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        consumesStacks: 1,
        when: conditions.selfBeDamaged,
        execute: actions.sequence(
          actions.choose(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_bingdong').condition(checks.exists()),
            contexts.damage.apply(ops.modifyDamage({ percent: 100, delta: 0 })),
            contexts.damage.apply(ops.modifyDamage({ percent: 50, delta: 0 })),
          ),
        ),
      }),
    ),
    effect_skill_add_damage_100_or_add_mark_shijianzhadan: compileEffect(
      defineEffect({
        id: 'effect_skill_add_damage_100_or_add_mark_shijianzhadan',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_shijianfaze').condition(checks.exists()),
            contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: 100 })),
            targets.opponentActive.apply(ops.addMark(resolved.get('mark_shijianzhadan')!)),
          ),
        ),
      }),
    ),
    effect_skill_add_damage_50_or_add_mark_dingshizhadan: compileEffect(
      defineEffect({
        id: 'effect_skill_add_damage_50_or_add_mark_dingshizhadan',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_shijianfaze').condition(checks.exists()),
            contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: 50 })),
            targets.opponentActive.apply(ops.addMark(resolved.get('mark_dingshizhadan')!)),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_mabi_30_percent_or_shandianluoyin_if_fail: (() => {
      const parameters = {
        action0_value_condition_percent: numberParam({
          default: 30,
          tags: ['skill_effect_probability', 'mark_mabi_chance'],
          legacyAliases: [],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_mabi_30_percent_or_shandianluoyin_if_fail',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.selfUsesSkill,
          execute: actions.sequence(
            actions.choose(
              conditions.chance(parameters.action0_value_condition_percent),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_mabi')!)),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shandianluoyin')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_mabi_15_percent_or_raise_spa_1_stage_50_percent: (() => {
      const parameters = {
        action0_value_condition_percent: numberParam({
          default: 15,
          tags: ['skill_effect_probability', 'mark_mabi_chance'],
          legacyAliases: [],
        }),
        action0_value_false_condition_percent: numberParam({
          default: 50,
          tags: ['skill_effect_probability'],
          legacyAliases: [],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_mabi_15_percent_or_raise_spa_1_stage_50_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.selfUsesSkill,
          execute: actions.sequence(
            actions.choose(
              conditions.chance(parameters.action0_value_condition_percent),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_mabi')!)),
              actions.choose(
                conditions.chance(parameters.action0_value_false_condition_percent),
                targets.ownerPet.apply(ops.changeStatStage('spa', 1)),
              ),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_opponent_shaoshang',
        on: 'OnHit',
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
        ),
        execute: actions.sequence(
          actions.choose(
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
            targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_opponent_shaoshang_10_percent: (() => {
      const parameters = {
        condition_1_1_percent: numberParam({ default: 10, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_10_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_1_percent)),
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_15_percent: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 15, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_15_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            conditions.chance(parameters.condition_1_percent),
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_20_percent: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 20, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_20_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            conditions.chance(parameters.condition_1_percent),
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_30_percent: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 30, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_30_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            conditions.chance(parameters.condition_1_percent),
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_5_percent: (() => {
      const parameters = {
        condition_1_1_percent: numberParam({ default: 5, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_5_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_1_percent)),
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_50_percent: (() => {
      const parameters = {
        condition_2_percent: numberParam({
          default: 50,
          tags: ['skill_effect_probability'],
          legacyAliases: ['effect_skill_add_mark_opponent_shaoshang_50_percent.probability'],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_50_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
            conditions.chance(parameters.condition_2_percent),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_60_percent: (() => {
      const parameters = {
        condition_2_percent: numberParam({ default: 60, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shaoshang_60_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
            conditions.chance(parameters.condition_2_percent),
          ),
          execute: actions.sequence(
            actions.choose(
              targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_mark_opponent_shaoshang_if_hp_above_75_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_opponent_shaoshang_if_hp_above_75_percent',
        on: 'OnHit',
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n * 0.75)),
          )
          return left !== undefined && right !== undefined && left > right
        }),
        execute: actions.sequence(
          actions.choose(
            targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Fire'),
            targets.opponentActive.apply(ops.addMark(resolved.get('mark_shaoshang')!)),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_opponent_shuimian_15_percent_or_raise_spe_1_stage_50_percent: (() => {
      const parameters = {
        action0_value_condition_percent: numberParam({
          default: 15,
          tags: ['skill_effect_probability'],
          legacyAliases: [],
        }),
        action0_value_false_condition_percent: numberParam({
          default: 50,
          tags: ['skill_effect_probability'],
          legacyAliases: [],
        }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_mark_opponent_shuimian_15_percent_or_raise_spe_1_stage_50_percent',
          on: 'OnHit',
          priority: 0,
          parameters,
          when: conditions.selfUsesSkill,
          execute: actions.sequence(
            actions.choose(
              conditions.chance(parameters.action0_value_condition_percent),
              targets.opponentActive.apply(ops.addMark(resolved.get('mark_shuimian')!)),
              actions.choose(
                conditions.chance(parameters.action0_value_false_condition_percent),
                targets.ownerPet.apply(ops.changeStatStage('spe', 1)),
              ),
            ),
          ),
        }),
      )
    })(),
    effect_skill_clear_opponent_spe_up_reverse_if_field_yemu: compileEffect(
      defineEffect({
        id: 'effect_skill_clear_opponent_spe_up_reverse_if_field_yemu',
        on: 'BeforeHit',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            contexts.battle
              .flatMap(battle => battle.marks)
              .where(mark => mark.baseId === 'mark_global_yemu')
              .condition(checks.exists()),
            targets.opponentActive.apply(ops.reverseStatStages({ stats: ['spe'], strategy: 'positive' })),
            targets.opponentActive.apply(ops.clearStatStages({ stats: ['spe'], strategy: 'positive' })),
          ),
        ),
      }),
    ),
    effect_skill_consume_mark_kongqichuliang_10_if_fail_reduce_damage_25_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_mark_kongqichuliang_10_if_fail_reduce_damage_25_percent',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(
                targets.ownerMarks
                  .where(mark => mark.baseId === 'mark_kongqichuliang')
                  .select(mark => mark.stack)
                  .all(),
              )
              const right = 10
              return right !== undefined && left.some(value => value >= right)
            },
            targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').apply(ops.consumeStacks(10)),
            contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
          ),
        ),
      }),
    ),
    effect_skill_consume_mark_kongqichuliang_15_if_fail_effect_skill_reduce_damage_25_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_mark_kongqichuliang_15_if_fail_effect_skill_reduce_damage_25_percent',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(
                targets.ownerMarks
                  .where(mark => mark.baseId === 'mark_kongqichuliang')
                  .select(mark => mark.stack)
                  .all(),
              )
              const right = 15
              return right !== undefined && left.some(value => value >= right)
            },
            targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').apply(ops.consumeStacks(15)),
            contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
          ),
        ),
      }),
    ),
    effect_skill_consume_mark_kongqichuliang_20_if_fail_effect_skill_reduce_damage_25_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_mark_kongqichuliang_20_if_fail_effect_skill_reduce_damage_25_percent',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(
                targets.ownerMarks
                  .where(mark => mark.baseId === 'mark_kongqichuliang')
                  .select(mark => mark.stack)
                  .all(),
              )
              const right = 20
              return right !== undefined && left.some(value => value >= right)
            },
            targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').apply(ops.consumeStacks(20)),
            contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
          ),
        ),
      }),
    ),
    effect_skill_consume_mark_kongqichuliang_25_if_fail_effect_skill_reduce_damage_25_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_mark_kongqichuliang_25_if_fail_effect_skill_reduce_damage_25_percent',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(
                targets.ownerMarks
                  .where(mark => mark.baseId === 'mark_kongqichuliang')
                  .select(mark => mark.stack)
                  .all(),
              )
              const right = 25
              return right !== undefined && left.some(value => value >= right)
            },
            targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').apply(ops.consumeStacks(25)),
            contexts.damage.apply(ops.modifyDamage({ percent: -25, delta: 0 })),
          ),
        ),
      }),
    ),
    effect_skill_consume_xinzhiyinji_multihit: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_xinzhiyinji_multihit',
        on: 'AfterUseSkillCheck',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            targets.opponentMarks.where(mark => mark.tags.includes('xinzhiyinji_tag')).condition(checks.exists()),
            contexts.skillUse.apply(ops.setMultihit(selectFrom([5, 8]).all())),
            contexts.skillUse.apply(ops.setMultihit(1)),
          ),
        ),
      }),
    ),
    effect_skill_multihit_if_height_above_100: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_if_height_above_100',
        on: 'AfterUseSkillCheck',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
              const right = 100
              return left !== undefined && right !== undefined && left > right
            },
            contexts.skillUse.apply(ops.setMultihit(3)),
            contexts.skillUse.apply(ops.setMultihit(1)),
          ),
        ),
      }),
    ),
    effect_skill_multihit_if_height_gt_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_if_height_gt_opponent',
        on: 'AfterUseSkillCheck',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
              const right = ctx.read(targets.opponentActive.select(pet => pet.height).first())
              return left !== undefined && right !== undefined && left > right
            },
            contexts.skillUse.apply(ops.setMultihit(3)),
            contexts.skillUse.apply(ops.setMultihit(1)),
          ),
        ),
      }),
    ),
    effect_skill_multihit_if_height_lt_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_if_height_lt_opponent',
        on: 'AfterUseSkillCheck',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: actions.sequence(
          actions.choose(
            (ctx: EffectFrame) => {
              const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
              const right = ctx.read(targets.opponentActive.select(pet => pet.height).first())
              return left !== undefined && right !== undefined && left < right
            },
            contexts.skillUse.apply(ops.setMultihit(3)),
            contexts.skillUse.apply(ops.setMultihit(1)),
          ),
        ),
      }),
    ),
  })
}
