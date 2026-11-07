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
export function createGeneratedSkillOutcomeEffects() {
  return Object.freeze({
    effect_ability_add_crit_rate_10_if_opponent_has_mark_shihua: compileEffect(
      defineEffect({
        id: 'effect_ability_add_crit_rate_10_if_opponent_has_mark_shihua',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_shihua')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(10)),
      }),
    ),
    effect_ability_add_skill_accuracy_10_percent_when_yanre: compileEffect(
      defineEffect({
        id: 'effect_ability_add_skill_accuracy_10_percent_when_yanre',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.battle
            .flatMap(battle => battle.marks)
            .where(mark => mark.baseId === 'mark_global_yanre')
            .condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addAccuracy(10)),
      }),
    ),
    effect_ability_add_water_skill_accuracy_5_percent_has_kongqichuliang: compileEffect(
      defineEffect({
        id: 'effect_ability_add_water_skill_accuracy_5_percent_has_kongqichuliang',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_kongqichuliang').condition(checks.exists()),
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Water'),
        ),
        apply: contexts.skillUse.apply(ops.addAccuracy(5)),
      }),
    ),
    effect_ability_electric_crit_rate_boost_10_percent: compileEffect(
      defineEffect({
        id: 'effect_ability_electric_crit_rate_boost_10_percent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Electric'),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(10)),
      }),
    ),
    effect_ability_shenguang_sure_hit_below_half_hp: compileEffect(
      defineEffect({
        id: 'effect_ability_shenguang_sure_hit_below_half_hp',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Light'),
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
            const right = ctx.read(
              targets.ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n / 2)),
            )
            return left !== undefined && right !== undefined && left < right
          },
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_ability_status_skill_sure_hit: compileEffect(
      defineEffect({
        id: 'effect_ability_status_skill_sure_hit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Status'),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_emblem_immune_skill_bandao: compileEffect(
      defineEffect({
        id: 'effect_emblem_immune_skill_bandao',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_bandao'),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_emblem_increase_crit_rate_when_dongqifuti: compileEffect(
      defineEffect({
        id: 'effect_emblem_increase_crit_rate_when_dongqifuti',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_dongqifuti').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(5)),
      }),
    ),
    effect_emblem_sure_hit_when_yanre: compileEffect(
      defineEffect({
        id: 'effect_emblem_sure_hit_when_yanre',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.battle
            .flatMap(battle => battle.marks)
            .where(mark => mark.baseId === 'mark_global_yanre')
            .condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_emblem_xianzhi_crit_rate_5_percent_if_first: compileEffect(
      defineEffect({
        id: 'effect_emblem_xianzhi_crit_rate_5_percent_if_first',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.sourceOwnsEvent, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.addCritRate(5)),
      }),
    ),
    effect_mark_bizhong: compileEffect(
      defineEffect({
        id: 'effect_mark_bizhong',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.sourceOwnsEvent),
        apply: contexts.skillUse.apply(ops.setSureHit(99)),
      }),
    ),
    effect_mark_cant_evasion: compileEffect(
      defineEffect({
        id: 'effect_mark_cant_evasion',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: contexts.skillUse.apply(ops.setSureHit(1)),
      }),
    ),
    effect_mark_evade: compileEffect(
      defineEffect({
        id: 'effect_mark_evade',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.skillActorDiffersFromOwner, conditions.ownerIsSkillTarget),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_mark_evade_physical_attacks: compileEffect(
      defineEffect({
        id: 'effect_mark_evade_physical_attacks',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.skillActorDiffersFromOwner,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Physical'),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_mark_evade_physical_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_evade_physical_with_stack',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.skillActorDiffersFromOwner,
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Physical'),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_mark_evade_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_evade_with_stack',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(conditions.skillActorDiffersFromOwner, conditions.ownerIsSkillTarget),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_mark_evasion_special_attacks: compileEffect(
      defineEffect({
        id: 'effect_mark_evasion_special_attacks',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.skillActorDiffersFromOwner,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Special'),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_mark_silence: compileEffect(
      defineEffect({
        id: 'effect_mark_silence',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          conditions.not(contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.setSureMiss(-1)),
      }),
    ),
    effect_mark_skill_sure_hit: compileEffect(
      defineEffect({
        id: 'effect_mark_skill_sure_hit',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: contexts.skillUse.apply(ops.setSureHit(1)),
      }),
    ),
    effect_skill_add_accuracy_25_per_shahezhili_turn: (() => {
      const parameters = { amount_step2: numberParam({ default: 25, tags: [], legacyAliases: [] }) }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_accuracy_25_per_shahezhili_turn',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            targets.ownerMarks.where(mark => mark.baseId === 'mark_shahezhili').condition(checks.exists()),
          ),
          apply: contexts.skillUse.apply(
            ops.addAccuracy(
              values.combine(
                targets.ownerMarks
                  .where(mark => mark.baseId === 'mark_shahezhili')
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
    effect_skill_add_accuracy_when_reused: compileEffect(
      defineEffect({
        id: 'effect_skill_add_accuracy_when_reused',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          conditions.all(
            conditions.ownerUsesSkill,
            contexts.skillUse.condition((_ctx, events) => (events[0]?.skill.owner?.lastSkillUsedTimes ?? 0) >= 2),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addAccuracy(25)),
      }),
    ),
    effect_skill_add_crit_rate_15_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_15_percent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addCritRate(15)),
      }),
    ),
    effect_skill_add_crit_rate_15_percent_if_hp_lt_half: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_15_percent_if_hp_lt_half',
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
        apply: contexts.skillUse.apply(ops.addCritRate(15)),
      }),
    ),
    effect_skill_add_crit_rate_25_per_shahezhili_turn: (() => {
      const parameters = { amount_step2: numberParam({ default: 25, tags: [], legacyAliases: [] }) }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_add_crit_rate_25_per_shahezhili_turn',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(
            conditions.selfUsesSkill,
            targets.ownerMarks.where(mark => mark.baseId === 'mark_shahezhili').condition(checks.exists()),
          ),
          apply: contexts.skillUse.apply(
            ops.addCritRate(
              values.combine(
                targets.ownerMarks
                  .where(mark => mark.baseId === 'mark_shahezhili')
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
    effect_skill_add_crit_rate_30_per_usetime: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_30_per_usetime',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        apply: contexts.skillUse.apply(
          ops.addCritRate(
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
    effect_skill_add_crit_rate_30_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_30_percent',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addCritRate(30)),
      }),
    ),
    effect_skill_add_crit_rate_50_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_50_if_first',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.addCritRate(50)),
      }),
    ),
    effect_skill_add_crit_rate_50_shuiwenzhenji: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_50_shuiwenzhenji',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiwenzhenji').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(50)),
      }),
    ),
    effect_skill_add_crit_rate_65_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_65_if_first',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.addCritRate(65)),
      }),
    ),
    effect_skill_add_crit_rate_70_shuiwenzhenji: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_70_shuiwenzhenji',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiwenzhenji').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(70)),
      }),
    ),
    effect_skill_add_crit_rate_85_if_opponent_has_mark_shihua: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_85_if_opponent_has_mark_shihua',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_shihua')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(85)),
      }),
    ),
    effect_skill_add_crit_rate_85_if_opponent_has_mark_zhongdu_and_haipa: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_85_if_opponent_has_mark_zhongdu_and_haipa',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_zhongdu')),
          ),
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_haipa')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(85)),
      }),
    ),
    effect_skill_add_crit_rate_95_if_has_jinbao: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_95_if_has_jinbao',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_jinbao').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.addCritRate(95)),
      }),
    ),
    effect_skill_add_crit_rate_ruodian: compileEffect(
      defineEffect({
        id: 'effect_skill_add_crit_rate_ruodian',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 1,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          ops.addCritRate(
            targets.opponentMarks
              .where(mark => mark.baseId === 'mark_ruodianjihao')
              .select(mark => mark.stack)
              .all()
              .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 45 : 0)))),
          ),
        ),
      }),
    ),
    effect_skill_consume_xinzhiyinji_sure_hit: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_xinzhiyinji_sure_hit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.tags.includes('xinzhiyinji_tag')).condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_crit_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_crit_if_first',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_increase_accuracy_50_if_higher_level: compileEffect(
      defineEffect({
        id: 'effect_skill_increase_accuracy_50_if_higher_level',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.level).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.level).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.addAccuracy(50)),
      }),
    ),
    effect_skill_increase_crit_rate_95_if_max_hp_gt_opponent: compileEffect(
      defineEffect({
        id: 'effect_skill_increase_crit_rate_95_if_max_hp_gt_opponent',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.stat.maxHp).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.stat.maxHp).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.addCritRate(95)),
      }),
    ),
    effect_skill_set_sure_crit_if_hp_below_half: compileEffect(
      defineEffect({
        id: 'effect_skill_set_sure_crit_if_hp_below_half',
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
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_set_sure_crit_if_hp_below_quarter: compileEffect(
      defineEffect({
        id: 'effect_skill_set_sure_crit_if_hp_below_quarter',
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
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_set_sure_hit_if_field_yemu: compileEffect(
      defineEffect({
        id: 'effect_skill_set_sure_hit_if_field_yemu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.battle
            .flatMap(battle => battle.marks)
            .where(mark => mark.baseId === 'mark_global_yemu')
            .condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_set_sure_hit_if_has_niliu: compileEffect(
      defineEffect({
        id: 'effect_skill_set_sure_hit_if_has_niliu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_niliu').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_setsurehit_opponent_has_mark_kuihuazhongzi: compileEffect(
      defineEffect({
        id: 'effect_skill_setsurehit_opponent_has_mark_kuihuazhongzi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_kuihuazhongzi')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_crit_below_1_4: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_crit_below_1_4',
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
        apply: contexts.skillUse.apply(ops.setSureCrit(0)),
      }),
    ),
    effect_skill_sure_crit_if_has_field: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_crit_if_has_field',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.tags.includes('area')).condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_sure_crit_if_has_yitelingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_crit_if_has_yitelingyu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_sure_crit_if_opponent_bingdong: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_crit_if_opponent_bingdong',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_bingdong')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_sure_crit_if_opponent_has_2_kongjuzhinian: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_crit_if_opponent_has_2_kongjuzhinian',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(
            targets.opponentMarks
              .where(mark => mark.baseId === 'mark_kongjuzhinian')
              .select(mark => mark.stack)
              .all(),
          )
          const right = 2
          return right !== undefined && left.some(value => value >= right)
        }),
        apply: contexts.skillUse.apply(ops.setSureCrit(1)),
      }),
    ),
    effect_skill_sure_crit_shuiwenzhenji: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_crit_shuiwenzhenji',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiwenzhenji').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureCrit(0)),
      }),
    ),
    effect_skill_sure_hit_below_1_4_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_below_1_4_hp',
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
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_atk_over_500: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_atk_over_500',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.stat.atk).first())
          const right = 500
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_first',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_has_mark_yinghua: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_has_mark_yinghua',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_yinghua').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_has_xukongganying: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_has_xukongganying',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_xukongganying').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_has_zhaocai: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_has_zhaocai',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zhaocai').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_has_zhenkongzhixin: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_has_zhenkongzhixin',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zhenkongzhixin').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_height_above_100: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_height_above_100',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.height).first())
          const right = 100
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_opponent_has_maimaijinzhen: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_opponent_has_maimaijinzhen',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_maimaijinzhen')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_opponent_has_mark_mabi: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_opponent_has_mark_mabi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_mabi')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_opponent_has_tongjiling: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_opponent_has_tongjiling',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_tongjiling')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_if_opponent_spa_gt_atk: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_if_opponent_spa_gt_atk',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.opponentActive.select(pet => pet.stat.spa).first())
          const right = ctx.read(targets.opponentActive.select(pet => pet.stat.atk).first())
          return left !== undefined && right !== undefined && left > right
        }),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_opponent_below_quarter_hp: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_opponent_below_quarter_hp',
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
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_opponent_jingshencuoluan: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_opponent_jingshencuoluan',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_jingshencuoluan')),
          ),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_opponent_shaoshang: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_opponent_shaoshang',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.baseId === 'mark_shaoshang').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
    effect_skill_sure_hit_opponent_xuanyun: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_opponent_xuanyun',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentMarks.where(mark => mark.baseId === 'mark_xuanyun').condition(checks.exists()),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      }),
    ),
  })
}
export const generatedSkillOutcomeEffects = createGeneratedSkillOutcomeEffects()
