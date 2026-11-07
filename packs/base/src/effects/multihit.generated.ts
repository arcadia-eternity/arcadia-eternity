// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
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
export function createGeneratedMultihit() {
  return Object.freeze({
    effect_ability_add_multihit_1_on_multihit_skill: compileEffect(
      defineEffect({
        id: 'effect_ability_add_multihit_1_on_multihit_skill',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(contexts.skillUse.select(event => event.multihitResult).first())
          const right = 1
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(contexts.skillUse.apply(ops.addMultihitResult(1))),
      }),
    ),
    effect_mark_shuangpozhan_add_2_hits: compileEffect(
      defineEffect({
        id: 'effect_mark_shuangpozhan_add_2_hits',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_shuangpozhan'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.addMultihitResult(2))),
      }),
    ),
    effect_mark_shuangrenzhan_add_2_hits: compileEffect(
      defineEffect({
        id: 'effect_mark_shuangrenzhan_add_2_hits',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_shuangrenzhan'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.addMultihitResult(2))),
      }),
    ),
    effect_skill_add_hit_result_ruodian: compileEffect(
      defineEffect({
        id: 'effect_skill_add_hit_result_ruodian',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          contexts.skillUse.apply(
            ops.addMultihitResult(
              targets.opponentMarks
                .where(mark => mark.baseId === 'mark_ruodianjihao')
                .select(mark => mark.stack)
                .all(),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_multihit_opponent_has_mark_kuihuazhongzi: compileEffect(
      defineEffect({
        id: 'effect_skill_add_multihit_opponent_has_mark_kuihuazhongzi',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_kuihuazhongzi')),
          ),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.addMultihitResult(1))),
      }),
    ),
    effect_skill_add_multihit_per_usetime: compileEffect(
      defineEffect({
        id: 'effect_skill_add_multihit_per_usetime',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        apply: actions.sequence(
          contexts.skillUse.apply(
            ops.addMultihitResult(
              targets.ownerPet
                .select(pet => pet.lastSkillUsedTimes)
                .all()
                .map(items => items.map((n, index) => n + (index === 0 ? -1 : 0)))
                .map(items => items.map((n, index) => Math.min(n, index === 0 ? 3 : 0))),
            ),
          ),
        ),
      }),
    ),
    effect_skill_multi_hit_5_times_if_has_shuiliangchongzu: compileEffect(
      defineEffect({
        id: 'effect_skill_multi_hit_5_times_if_has_shuiliangchongzu',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiliangchongzu').condition(checks.exists()),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(5))),
      }),
    ),
    effect_skill_multihit_3_if_has_zhaocai: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_3_if_has_zhaocai',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_zhaocai').condition(checks.exists()),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(3))),
      }),
    ),
    effect_skill_multihit_3_times_if_opponent_has_tongjiling: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_3_times_if_opponent_has_tongjiling',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_tongjiling')),
          ),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(3))),
      }),
    ),
    effect_skill_multihit_30_percent_4_times: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 30, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_multihit_30_percent_4_times',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_percent)),
          apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(4))),
        }),
      )
    })(),
    effect_skill_multihit_35_percent_4_times: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 35, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_multihit_35_percent_4_times',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_percent)),
          apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(4))),
        }),
      )
    })(),
    effect_skill_multihit_4_if_first: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_4_if_first',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.firstSkillThisTurn),
        apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(4))),
      }),
    ),
    effect_skill_multihit_4_if_last: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_4_if_last',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.lastSkillThisTurn),
        apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(4))),
      }),
    ),
    effect_skill_multihit_4_times_if_last: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_4_times_if_last',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, conditions.lastSkillThisTurn),
        apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(4))),
      }),
    ),
    effect_skill_multihit_40_percent_3_times: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 40, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_multihit_40_percent_3_times',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_percent)),
          apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(3))),
        }),
      )
    })(),
    effect_skill_multihit_50_percent_2_times: (() => {
      const parameters = {
        condition_1_percent: numberParam({ default: 50, tags: ['skill_effect_probability'], legacyAliases: [] }),
      }
      return compileEffect(
        defineEffect({
          id: 'effect_skill_multihit_50_percent_2_times',
          triggers: [EffectTrigger.AfterUseSkillCheck],
          priority: 0,
          parameters,
          when: conditions.all(conditions.selfUsesSkill, conditions.chance(parameters.condition_1_percent)),
          apply: actions.sequence(contexts.skillUse.apply(ops.setMultihit(2))),
        }),
      )
    })(),
    effect_skill_multihit_by_shahezhili_turns: compileEffect(
      defineEffect({
        id: 'effect_skill_multihit_by_shahezhili_turns',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shahezhili').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(
            ops.setMultihit(
              targets.ownerMarks
                .where(mark => mark.baseId === 'mark_shahezhili')
                .select(mark => mark.duration)
                .first(),
            ),
          ),
        ),
      }),
    ),
    effect_skill_reduce_multihit_on_consecutive_hits_1_max_2: compileEffect(
      defineEffect({
        id: 'effect_skill_reduce_multihit_on_consecutive_hits_1_max_2',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        tags: ['xingzhili'],
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(targets.ownerPet.select(pet => pet.lastSkillUsedTimes).first())
          const right = 1
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(
          contexts.skillUse.apply(
            ops.addMultihitResult(
              targets.ownerPet
                .select(pet => pet.lastSkillUsedTimes)
                .all()
                .map(items => items.map((n, index) => n + (index === 0 ? -1 : 0)))
                .map(items => items.map((n, index) => Math.min(n, index === 0 ? 2 : 0)))
                .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? -1 : 0)))),
            ),
          ),
        ),
      }),
    ),
  })
}
export const generatedMultihit = createGeneratedMultihit()
