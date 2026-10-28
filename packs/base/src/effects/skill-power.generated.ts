// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  numberParam,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  values,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedSkillPowerEffects() {
  return Object.freeze({
    effect_ability_add_power_50_percent_normal: compileEffect(
      defineEffect({
        id: 'effect_ability_add_power_50_percent_normal',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Normal'),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.5)),
      }),
    ),
    effect_ability_amplify_power_consume_ruodian: compileEffect(
      defineEffect({
        id: 'effect_ability_amplify_power_consume_ruodian',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
            const right = ctx.read(
              targets.ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n / 4)),
            )
            return left !== undefined && right !== undefined && left < right
          },
          contexts.skillUse.condition((_ctx, events) =>
            events.some(event => event.skill.tags.includes('consume_ruodian')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.25)),
      }),
    ),
    effect_ability_damage_amplify_10_percent_weight_100kg: compileEffect(
      defineEffect({
        id: 'effect_ability_damage_amplify_10_percent_weight_100kg',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.ownerUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.weight).first())
          const right = 100
          return left !== undefined && right !== undefined && left >= right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.1)),
      }),
    ),
    effect_ability_fennu_power_boost_10_percent_when_rage_between_50_and_70: compileEffect(
      defineEffect({
        id: 'effect_ability_fennu_power_boost_10_percent_when_rage_between_50_and_70',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
            const right = 50
            return left !== undefined && right !== undefined && left >= right
          },
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
            const right = 70
            return left !== undefined && right !== undefined && left < right
          },
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.1)),
      }),
    ),
    effect_ability_fennu_power_boost_15_percent_when_rage_gt_70: compileEffect(
      defineEffect({
        id: 'effect_ability_fennu_power_boost_15_percent_when_rage_gt_70',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
            const right = 70
            return left !== undefined && right !== undefined && left >= right
          },
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
            const right = ctx.read(targets.selfPlayer.select(player => player.maxRage).first())
            return left !== undefined && right !== undefined && left < right
          },
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.15)),
      }),
    ),
    effect_ability_fennu_power_boost_25_percent_when_full_rage: compileEffect(
      defineEffect({
        id: 'effect_ability_fennu_power_boost_25_percent_when_full_rage',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.ownerUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
          const right = ctx.read(targets.selfPlayer.select(player => player.maxRage).first())
          return left !== undefined && right !== undefined && left === right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.25)),
      }),
    ),
    effect_ability_fire_power_boost_below_25_percent: compileEffect(
      defineEffect({
        id: 'effect_ability_fire_power_boost_below_25_percent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
            const right = ctx.read(
              targets.ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n / 4)),
            )
            return left !== undefined && right !== undefined && left < right
          },
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Fire'),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.25)),
      }),
    ),
    effect_ability_water_power_boost_below_25_percent: compileEffect(
      defineEffect({
        id: 'effect_ability_water_power_boost_below_25_percent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
            const right = ctx.read(
              targets.ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n / 4)),
            )
            return left !== undefined && right !== undefined && left < right
          },
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Water'),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.25)),
      }),
    ),
    effect_global_power_35_percent_bug: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_bug',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(
          contexts.skillUse.condition((_ctx, events) =>
            events.some(event => (['Bug'] as string[]).includes(event.element)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_global_power_35_percent_electric: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_electric',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(
          contexts.skillUse.condition((_ctx, events) =>
            events.some(event => (['Electric'] as string[]).includes(event.element)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_global_power_35_percent_fighting_dragon_ancient: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_fighting_dragon_ancient',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(
          contexts.skillUse.condition((_ctx, events) =>
            events.some(event => (['Fighting', 'Dragon', 'Ancient'] as string[]).includes(event.element)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_global_power_35_percent_fire: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_fire',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Fire')),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_global_power_35_percent_grass_light: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_grass_light',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(
          contexts.skillUse.condition((_ctx, events) =>
            events.some(event => (['Grass', 'Light'] as string[]).includes(event.element)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_global_power_35_percent_shadow_trait: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_shadow_trait',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(
          contexts.skillUse.condition((_ctx, events) =>
            events.some(event => (['Shadow', 'Trait'] as string[]).includes(event.element)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_global_power_35_percent_water: compileEffect(
      defineEffect({
        id: 'effect_global_power_35_percent_water',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.any(contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Water')),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.35)),
      }),
    ),
    effect_mark_add_power_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_add_power_stack',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addPower(targets.sourceMark.select(mark => mark.stack).all())),
      }),
    ),
    effect_mark_amplify_fire_skill_70: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_fire_skill_70',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Fire'),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.7)),
      }),
    ),
    effect_mark_amplify_next_damage_skill_power: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_next_damage_skill_power',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category !== 'Status'),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_mark_amplify_non_yanggong: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_non_yanggong',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category !== 'Status'),
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId !== 'skill_yanggong'),
        ),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_mark_amplify_skill_10: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_skill_10',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.ownerUsesSkill),
        apply: contexts.skillUse.apply(ops.amplifyPower(1.1)),
      }),
    ),
    effect_mark_reduce_power_special: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_power_special',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Special'),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(0.5)),
      }),
    ),
    effect_skill_add_power_10_per_opponent_manxingduyao: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_10_per_opponent_manxingduyao',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: () => true,
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'mark_manxingduyao')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 10 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_15_each_huohuanzhixin: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_15_each_huohuanzhixin',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerMarks
              .where(mark => mark.baseId === 'mark_huohuanzhixin')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 15 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_15_per_spd_level: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_15_per_spd_level',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'stat_stage_spd_up').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerMarks
              .where(mark => mark.baseId === 'stat_stage_spd_up')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 15 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_20_per_pofang_turn: (() => {
      const parameters = { amount_step2: numberParam({ default: 20, tags: [], legacyAliases: [] }) }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_power_20_per_pofang_turn',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.selfUsesSkill,
          apply: contexts.skillUse.apply(
            ops.addPower(
              values.combine(
                targets.opponentMarks
                  .where(mark => mark.baseId === 'mark_pofang')
                  .select(mark => mark.duration)
                  .all(),
                parameters.amount_step2,
                (items, factor) => items.map((n, index) => Math.floor(n * (index === 0 ? factor : 0))),
              ),
            ),
          ),
        }),
      )
    })(),
    effect_skill_add_power_25_if_has_field: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_25_if_has_field',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.tags.includes('area')).condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addPower(25)),
      }),
    ),
    effect_skill_add_power_25_zhongzinengliang: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_25_zhongzinengliang',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerMarks
              .where(mark => mark.baseId === 'mark_zhongzinengliang')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 25 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_30_has_mark_yinghua: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_30_has_mark_yinghua',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_yinghua').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      }),
    ),
    effect_skill_add_power_30_if_female: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_30_if_female',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Female')),
        ),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      }),
    ),
    effect_skill_add_power_30_if_male: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_30_if_male',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.gender === 'Male')),
        ),
        apply: contexts.skillUse.apply(ops.addPower(30)),
      }),
    ),
    effect_skill_add_power_30_per_shunliu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_30_per_shunliu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerMarks
              .where(mark => mark.baseId === 'mark_shunliu')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 30 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_30_per_stack_if_has_shunliu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_30_per_stack_if_has_shunliu',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shunliu').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerMarks
              .where(mark => mark.baseId === 'mark_shunliu')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 30 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_30_per_usetime: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_30_per_usetime',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerPet
              .select(pet => pet.lastSkillUsedTimes)
              .all()
              .map(items => items.map((n, index) => n + (index === 0 ? -1 : 0)))
              .map(items => items.map((n, index) => Math.min(n, index === 0 ? 3 : 0)))
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 30 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_35_if_opponent_spa_gt_atk: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_35_if_opponent_spa_gt_atk',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.opponentActive.select(pet => pet.stat.spa).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.stat.atk).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.addPower(35)),
      }),
    ),
    effect_skill_add_power_40_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_if_first',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      }),
    ),
    effect_skill_add_power_40_if_last: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_if_last',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.lastSkillThisTurn),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      }),
    ),
    effect_skill_add_power_40_if_opponent_has_mark_jingshencuoluan: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_if_opponent_has_mark_jingshencuoluan',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_jingshencuoluan')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addPower(40)),
      }),
    ),
    effect_skill_add_power_40_opponent_per_atk_level: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_opponent_per_atk_level',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'stat_stage_atk_up')),
          ),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'stat_stage_atk_up')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 40 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_40_opponent_per_def_level: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_opponent_per_def_level',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'stat_stage_def_up')),
          ),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'stat_stage_def_up')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 40 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_40_opponent_per_spa_level: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_opponent_per_spa_level',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'stat_stage_spa_up')),
          ),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'stat_stage_spa_up')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 40 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_40_opponent_per_spd_level: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_opponent_per_spd_level',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'stat_stage_spd_up')),
          ),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'stat_stage_spd_up')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 40 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_40_opponent_per_spe_level: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_40_opponent_per_spe_level',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'stat_stage_spe_up')),
          ),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'stat_stage_spe_up')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 40 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_50_consecutive_2_times: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_consecutive_2_times',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.everyNthUse(2)),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_skill_add_power_50_if_aideminyi: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_if_aideminyi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_aideminyi').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_skill_add_power_50_if_has_xukongganying: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_if_has_xukongganying',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_xukongganying').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_skill_add_power_50_if_opponent_renzhezhixin: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_if_opponent_renzhezhixin',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_renzhezhixin')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_skill_add_power_50_if_opponent_wuzhezhixin: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_if_opponent_wuzhezhixin',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_wuzhezhixin')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_skill_add_power_50_ruodian: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_ruodian',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.opponentMarks
              .where(mark => mark.baseId === 'mark_ruodianjihao')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 50 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_add_power_by_self_max_hp_minus_500: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_by_self_max_hp_minus_500',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.stat.maxHp).first())
          const right = 500
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .all()
              .map(items => items.map((n, index) => n + (index === 0 ? -500 : 0)))
              .map(items => items.map((n, index) => Math.max(n, index === 0 ? 0 : 0))),
          ),
        ),
      }),
    ),
    effect_skill_consume_xinzhiyinji_power_2x: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_xinzhiyinji_power_2x',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.tags.includes('xinzhiyinji_tag')).condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(
          ops.addPower(
            contexts.skillUse
              .select(event => event.power)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 1 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_power_100_if_bingzhilingyu_200_if_bingshuanglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_100_if_bingzhilingyu_200_if_bingshuanglingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addPower(
            values.choose(
              targets.ownerMarks.where(mark => mark.baseId === 'mark_bingshuanglingyu').condition(checks.exists()),
              [150],
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_bingzhilingyu').condition(checks.exists()),
                [50],
                [],
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_power_100_if_dianzhilingyu_200_if_diancilingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_100_if_dianzhilingyu_200_if_diancilingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addPower(
            values.choose(
              targets.ownerMarks.where(mark => mark.baseId === 'mark_diancilingyu').condition(checks.exists()),
              [150],
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_dianzhilingyu').condition(checks.exists()),
                [50],
                [],
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_power_100_if_fengzhilingyu_200_if_fengbaolingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_100_if_fengzhilingyu_200_if_fengbaolingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addPower(
            values.choose(
              targets.ownerMarks.where(mark => mark.baseId === 'mark_fengbaolingyu').condition(checks.exists()),
              [150],
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_fengzhilingyu').condition(checks.exists()),
                [50],
                [],
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_power_2x_below_quarter_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_below_quarter_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n / 4)),
          )
          return left !== undefined && right !== undefined && left <= right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_anzhilingyu_or_anyinglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_anzhilingyu_or_anyinglingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.any(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_anzhilingyu').condition(checks.exists()),
            targets.ownerMarks.where(mark => mark.baseId === 'mark_anyinglingyu').condition(checks.exists()),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_first',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 1,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_first_round: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_first_round',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 1,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(contexts.battle.select(battle => battle.currentTurn).first())
          const right = 1
          return left !== undefined && right !== undefined && left === right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_first_switch_in_zuijiazhuogong: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_first_switch_in_zuijiazhuogong',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 1,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_first_turn_after_switch').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_guangzhilingyu_or_guanghuilingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_guangzhilingyu_or_guanghuilingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.any(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_guangzhilingyu').condition(checks.exists()),
            targets.ownerMarks.where(mark => mark.baseId === 'mark_guanghuilingyu').condition(checks.exists()),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_mark_chongzhilingyu_or_chongqunLingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_mark_chongzhilingyu_or_chongqunLingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.any(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_chongzhilingyu').condition(checks.exists()),
            targets.ownerMarks.where(mark => mark.baseId === 'mark_chongqunlingyu').condition(checks.exists()),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_mark_feizhilingyu_or_feikonglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_mark_feizhilingyu_or_feikonglingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.any(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_feizhilingyu').condition(checks.exists()),
            targets.ownerMarks.where(mark => mark.baseId === 'mark_feikonglingyu').condition(checks.exists()),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_mark_penti: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_mark_penti',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_penti').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_mark_qianglipenti: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_mark_qianglipenti',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_qianglipenti').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_mark_shazhilingyu_or_shabaoLingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_mark_shazhilingyu_or_shabaoLingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.any(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhilingyu').condition(checks.exists()),
            targets.ownerMarks.where(mark => mark.baseId === 'mark_shabaoLingyu').condition(checks.exists()),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_mark_zhanzhilingyu_or_zhandouLingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_mark_zhanzhilingyu_or_zhandouLingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.any(
            targets.ownerMarks.where(mark => mark.baseId === 'mark_zhanzhilingyu').condition(checks.exists()),
            targets.ownerMarks.where(mark => mark.baseId === 'mark_zhandoulingyu').condition(checks.exists()),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_shuiliangbaohe: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_shuiliangbaohe',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiliangbaohe').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_shuiliangchongzu: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_shuiliangchongzu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiliangchongzu').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_xukongganying: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_xukongganying',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_xukongganying').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_has_zhaocai: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_has_zhaocai',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zhaocai').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_height_above_100: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_height_above_100',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
          const right = 100
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_height_gt_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_height_gt_opponent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.height).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_height_lt_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_height_lt_opponent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.height).first())
          return left !== undefined && right !== undefined && left < right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_hp_above_half: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_hp_above_half',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n * 0.5)),
          )
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_hp_below_half: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_hp_below_half',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n * 0.5)),
          )
          return left !== undefined && right !== undefined && left < right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_last: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_last',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.lastSkillThisTurn),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_oppoent_has_yinzhiwang: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_oppoent_has_yinzhiwang',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_yinzhiwang')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_has_mark_haipa: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_has_mark_haipa',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_haipa')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_has_mark_hunmi: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_has_mark_hunmi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_hunmi')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_has_mark_jingshencuoluan_and_haipa: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_has_mark_jingshencuoluan_and_haipa',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_jingshencuoluan')),
          ),
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_haipa')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_has_mark_mabi: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_has_mark_mabi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_mabi')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_has_shield: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_has_shield',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.tags.includes('shield')).condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_hunluan: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_hunluan',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_hunluan')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_is_bingdong: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_is_bingdong',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_bingdong')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_mabi: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_mabi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_mabi')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_shuimian: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_shuimian',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_shuimian')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_shuimian_or_mabi: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_shuimian_or_mabi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks
            .where(mark => (['mark_shuimian', 'mark_mabi'] as string[]).includes(mark.baseId))
            .condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_opponent_zhixi: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_opponent_zhixi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_zhixi')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_if_self_full_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_if_self_full_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(targets.ownerPet.select(pet => pet.stat.maxHp).first())
          return left !== undefined && right !== undefined && left === right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_opponent_below_quarter_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_opponent_below_quarter_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.opponentActive.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.opponentActive
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n / 4)),
          )
          return left !== undefined && right !== undefined && left <= right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_opponent_maxhp: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_opponent_maxhp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.opponentActive.select(pet => pet.stat.maxHp).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.currentHp).first())
          return left !== undefined && right !== undefined && left === right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_2x_opponent_shaoshang: compileEffect(
      defineEffect({
        id: 'effect_skill_power_2x_opponent_shaoshang',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.baseId === 'mark_shaoshang').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power_4x_10_percent: (() => {
      const parameters = {
        condition_1_1_percent: numberParam({ default: 10, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_power_4x_10_percent',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_1_percent)),
          ),
          apply: contexts.skillUse.apply(ops.amplifyPower(4)),
        }),
      )
    })(),
    effect_skill_power_4x_below_1_6_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_power_4x_below_1_6_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.ownerPet
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n / 6)),
          )
          return left !== undefined && right !== undefined && left <= right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(4)),
      }),
    ),
    effect_skill_power_4x_if_has_mark_chaojipenti: compileEffect(
      defineEffect({
        id: 'effect_skill_power_4x_if_has_mark_chaojipenti',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_chaojipenti').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(4)),
      }),
    ),
    effect_skill_power_4x_if_has_mark_qianglipenti: compileEffect(
      defineEffect({
        id: 'effect_skill_power_4x_if_has_mark_qianglipenti',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_qianglipenti').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(4)),
      }),
    ),
    effect_skill_power_4x_opponent_below_quarter_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_power_4x_opponent_below_quarter_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.opponentActive.select(pet => pet.currentHp).first())
          const right = ctx.read(
            targets.opponentActive
              .select(pet => pet.stat.maxHp)
              .first()
              .map(n => Math.floor(n / 4)),
          )
          return left !== undefined && right !== undefined && left <= right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(4)),
      }),
    ),
    effect_skill_power_plus_50_if_opponent_has_kongjuzhinian: compileEffect(
      defineEffect({
        id: 'effect_skill_power_plus_50_if_opponent_has_kongjuzhinian',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_kongjuzhinian')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      }),
    ),
    effect_skill_power2x_if_heavier: compileEffect(
      defineEffect({
        id: 'effect_skill_power2x_if_heavier',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.weight).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.weight).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power2x_if_higher_level: compileEffect(
      defineEffect({
        id: 'effect_skill_power2x_if_higher_level',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.level).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.level).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power2x_if_opponent_has_exceptional: compileEffect(
      defineEffect({
        id: 'effect_skill_power2x_if_opponent_has_exceptional',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.tags.includes('exceptional')).condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power2x_if_opponent_has_tongjiling_and_below_half_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_power2x_if_opponent_has_tongjiling_and_below_half_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_tongjiling')),
          ),
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.opponentActive.select(pet => pet.currentHp).first())
            const right = ctx.read(
              targets.opponentActive
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n * 0.5)),
            )
            return left !== undefined && right !== undefined && left < right
          },
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power2x_if_weight_above_99: compileEffect(
      defineEffect({
        id: 'effect_skill_power2x_if_weight_above_99',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.weight).first())
          const right = 99
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_power2x_vs_wind_psychic_fighting_trait: compileEffect(
      defineEffect({
        id: 'effect_skill_power2x_vs_wind_psychic_fighting_trait',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => (['Wind', 'Psychic', 'Fighting', 'Trait'] as string[]).includes(pet.element)),
          ),
        ),
        apply: contexts.skillUse.apply(ops.amplifyPower(2)),
      }),
    ),
    effect_skill_reduce_power_on_consecutive_hits_10_max_20: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_power_on_consecutive_hits_10_max_20',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        tags: ['xingzhili'],
        when: conditions.all(conditions.selfUsesSkill),
        apply: contexts.skillUse.apply(
          ops.addPower(
            targets.ownerPet
              .select(pet => pet.lastSkillUsedTimes)
              .all()
              .map(items => items.map((n, index) => n + (index === 0 ? -1 : 0)))
              .map(items => items.map((n, index) => Math.min(n, index === 0 ? 2 : 0)))
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? -10 : 0)))),
          ),
        ),
      }),
    ),
  })
}
export const generatedSkillPowerEffects = createGeneratedSkillPowerEffects()
