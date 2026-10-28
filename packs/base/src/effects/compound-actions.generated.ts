// Reviewed native behavior; edit this TypeScript source directly.
import { BaseMark } from '@arcadia-eternity/battle/v4'
import {
  EffectTrigger,
  selectFrom,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
  values,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export const generatedCompoundActionDependencies = Object.freeze([
  'mark_anyinglingyu',
  'mark_anzhilingyu',
  'mark_baiya',
  'mark_bingshuanglingyu',
  'mark_bingzhilingyu',
  'mark_chongqunlingyu',
  'mark_chongzhilingyu',
  'mark_diancilingyu',
  'mark_dianzhilingyu',
  'mark_dongshang',
  'mark_feikonglingyu',
  'mark_feizhilingyu',
  'mark_fengbaolingyu',
  'mark_fengzhilingyu',
  'mark_guanghudun',
  'mark_guanghuilingyu',
  'mark_guangzhilingyu',
  'mark_heiya',
  'mark_huifu_50_per_turn',
  'mark_huixin',
  'mark_hunluan',
  'mark_jinzhenfenmo',
  'mark_kongju',
  'mark_liuxie',
  'mark_mabi',
  'mark_maidijinzhen',
  'mark_meihuo',
  'mark_shabaolingyu',
  'mark_shanghaizengjia',
  'mark_shazhilingyu',
  'mark_xukongganying',
  'mark_yinbopingzhang',
  'mark_zaoyin',
  'mark_zhandoulingyu',
  'mark_zhanzhilingyu',
  'mark_zhongdu',
])
export function createGeneratedCompoundActions(marks: ReadonlyMap<string, BaseMark>) {
  const resolved = new Map<string, BaseMark>()
  for (const id of generatedCompoundActionDependencies) {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id)
      throw new Error('Missing or mismatched native mark dependency: ' + id)
    resolved.set(id, mark)
  }
  return Object.freeze({
    effect_mark_add_crit_on_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_add_crit_on_damage',
        triggers: [EffectTrigger.PostDamage],
        priority: 0,
        when: conditions.all(conditions.selfBeDamaged),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_huixin')!)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_add_guanghudun_on_turn_end_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_add_guanghudun_on_turn_end_with_stack',
        triggers: [EffectTrigger.TurnEnd],
        priority: 0,
        when: conditions.all(conditions.ownerIsActive, (ctx: EffectFrame) => {
          const left = ctx.read(targets.sourceMark.select(mark => mark.stack).first())
          const right = 1
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(resolved.get('mark_guanghudun')!, {
              stack: targets.sourceMark.select(mark => mark.stack).first(),
            }),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_add_mark_zhongdu_if_using_physical_attack: compileEffect(
      defineEffect({
        id: 'effect_mark_add_mark_zhongdu_if_using_physical_attack',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Physical'),
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_zhongdu')!)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_add_multihit_1_on_next_multihit_skill: compileEffect(
      defineEffect({
        id: 'effect_mark_add_multihit_1_on_next_multihit_skill',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(contexts.skillUse.select(event => event.multihitResult).first())
          const right = 1
          return left !== undefined && right !== undefined && left > right
        }),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.addMultihitResult(1)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_double_rage_cost_double_damage_non_climax: compileEffect(
      defineEffect({
        id: 'effect_mark_double_rage_cost_double_damage_non_climax',
        triggers: [EffectTrigger.OnMarkCreated],
        priority: 0,
        when: () => true,
        apply: actions.sequence(
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Climax')
            .where(skill => (skill.category as string) !== 'Status')
            .apply(ops.addSkillAttributeModifier('rage', 'percent', 100, { lifetime: 'sourceMarkOrTargetSkill' })),
          targets.selfSkills
            .where(skill => (skill.category as string) !== 'Climax')
            .where(skill => (skill.category as string) !== 'Status')
            .apply(ops.addSkillAttributeModifier('power', 'percent', 100, { lifetime: 'sourceMarkOrTargetSkill' })),
        ),
      }),
    ),
    effect_mark_fear_consume_stacks_at_3: compileEffect(
      defineEffect({
        id: 'effect_mark_fear_consume_stacks_at_3',
        triggers: [EffectTrigger.OnStack],
        priority: 0,
        when: conditions.all(
          (ctx: EffectFrame) => {
            const left = ctx.read(contexts.stack.select(event => event.stacksAfter).first())
            const right = 3
            return left !== undefined && right !== undefined && left >= right
          },
          (ctx: EffectFrame) => {
            const left = ctx.read(contexts.stack.select(event => event.stacksBefore).first())
            const right = 3
            return left !== undefined && right !== undefined && left < right
          },
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_kongju')!)),
          targets.sourceMark.apply(ops.consumeStacks(targets.sourceMark.select(mark => mark.stack).first())),
        ),
      }),
    ),
    effect_mark_hunluan_consume_stacks_at_2: compileEffect(
      defineEffect({
        id: 'effect_mark_hunluan_consume_stacks_at_2',
        triggers: [EffectTrigger.OnStack],
        priority: 0,
        when: conditions.all(
          (ctx: EffectFrame) => {
            const left = ctx.read(contexts.stack.select(event => event.stacksAfter).first())
            const right = 2
            return left !== undefined && right !== undefined && left >= right
          },
          (ctx: EffectFrame) => {
            const left = ctx.read(contexts.stack.select(event => event.stacksBefore).first())
            const right = 2
            return left !== undefined && right !== undefined && left < right
          },
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_hunluan')!)),
          targets.sourceMark.apply(ops.consumeStacks(targets.sourceMark.select(mark => mark.stack).first())),
        ),
      }),
    ),
    effect_mark_shandianluoyin_paralyze: compileEffect(
      defineEffect({
        id: 'effect_mark_shandianluoyin_paralyze',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.baseId === 'skill_shandianluoyin'),
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_mabi')!)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_xukongtizhi_consume_on_evasion: compileEffect(
      defineEffect({
        id: 'effect_mark_xukongtizhi_consume_on_evasion',
        triggers: [EffectTrigger.OnMiss],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_xukongtizhi').condition(checks.exists()),
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_xukongganying')!)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_add_mark_anzhilingyu_or_anyinglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_anzhilingyu_or_anyinglingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_anyinglingyu')!,
                resolved.get('mark_anzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_bingzhilingyu_or_bingshuanglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_bingzhilingyu_or_bingshuanglingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_bingshuanglingyu')!,
                resolved.get('mark_bingzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_both_shanghaizengjia_50: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_both_shanghaizengjia_50',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(ops.addMark(resolved.get('mark_shanghaizengjia')!, { stack: 50 })),
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_shanghaizengjia')!, { stack: 50 })),
        ),
      }),
    ),
    effect_skill_add_mark_chongzhilingyu_or_chongqunLingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_chongzhilingyu_or_chongqunLingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_chongqunlingyu')!,
                resolved.get('mark_chongzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_dianzhilingyu_or_diancilingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_dianzhilingyu_or_diancilingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_diancilingyu')!,
                resolved.get('mark_dianzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_feizhilingyu_or_feikonglingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_feizhilingyu_or_feikonglingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_feikonglingyu')!,
                resolved.get('mark_feizhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_fengzhilingyu_or_fengbaolingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_fengzhilingyu_or_fengbaolingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_fengbaolingyu')!,
                resolved.get('mark_fengzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_guangzhilingyu_or_guanghuilingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_guangzhilingyu_or_guanghuilingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_guanghuilingyu')!,
                resolved.get('mark_guangzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_opponent_baiya_equal_damage_max_800: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_opponent_baiya_equal_damage_max_800',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(
            ops.addMark(resolved.get('mark_baiya')!, {
              stack: contexts.damage
                .select(event => event.damageResult)
                .first()
                .map(n => Math.min(n, 800)),
            }),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_opponent_dongshang_10_percent_if_consume_dongqifuti_70_percent: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_opponent_dongshang_10_percent_if_consume_dongqifuti_70_percent',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Ice'),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_dongqifuti').condition(checks.exists()),
          conditions.chance(
            values.choose(
              targets.ownerMarks.where(mark => mark.baseId === 'mark_dongqifuti').condition(checks.exists()),
              70,
              10,
            ),
          ),
        ),
        apply: actions.sequence(
          targets.opponentActive.apply(ops.addMark(resolved.get('mark_dongshang')!)),
          targets.opponentMarks.where(mark => mark.baseId === 'mark_dongqifuti').apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_add_mark_opponent_heiya_equal_damage_max_800: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_opponent_heiya_equal_damage_max_800',
        triggers: [EffectTrigger.OnDamage],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.opponentActive.apply(
            ops.addMark(resolved.get('mark_heiya')!, {
              stack: contexts.damage
                .select(event => event.damageResult)
                .first()
                .map(n => Math.min(n, 800)),
            }),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_opponent_meihuo: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_opponent_meihuo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill),
        apply: actions.sequence(targets.opponentActive.apply(ops.addMark(resolved.get('mark_meihuo')!))),
      }),
    ),
    effect_skill_add_mark_shazhilingyu_or_shabaoLingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_shazhilingyu_or_shabaoLingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_shabaolingyu')!,
                resolved.get('mark_shazhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_mark_zhanzhilingyu_or_zhandoulingyu: compileEffect(
      defineEffect({
        id: 'effect_skill_add_mark_zhanzhilingyu_or_zhandoulingyu',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(
              values.choose(
                targets.ownerMarks.where(mark => mark.baseId === 'mark_yitelingyu').condition(checks.exists()),
                resolved.get('mark_zhandoulingyu')!,
                resolved.get('mark_zhanzhilingyu')!,
              ),
            ),
          ),
        ),
      }),
    ),
    effect_skill_add_multihit_1_consume_shazhidanke: compileEffect(
      defineEffect({
        id: 'effect_skill_add_multihit_1_consume_shazhidanke',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.addMultihitResult(1)),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
    effect_skill_consume_huanxiang_add_mark_opponent_dongshang: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_huanxiang_add_mark_opponent_dongshang',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').condition(checks.exists()),
          targets.opponentActive.condition((_ctx, pets) => pets[0]?.element !== 'Ice'),
        ),
        apply: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').apply(ops.consumeStacks(1)),
          targets.opponentActive.apply(ops.addMark(resolved.get('mark_dongshang')!)),
        ),
      }),
    ),
    effect_skill_consume_huanxiang_multihit_2: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_huanxiang_multihit_2',
        triggers: [EffectTrigger.BeforeMultiHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.addMultihitResult(1)),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
    effect_skill_consume_huanxiang_multihit_4_to_5: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_huanxiang_multihit_4_to_5',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.setMultihit(selectFrom([4, 5]).all())),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
    effect_skill_consume_maidijinzhen_add_jinzhenfenmo: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_maidijinzhen_add_jinzhenfenmo',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_maidijinzhen')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_maidijinzhen').apply(ops.consumeStacks(1)),
          targets.opponentActive.apply(ops.addMark(resolved.get('mark_jinzhenfenmo')!)),
        ),
      }),
    ),
    effect_skill_consume_maimaijinzhen_add_liuxie_50: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_maimaijinzhen_add_liuxie_50',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_maimaijinzhen')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_maimaijinzhen').apply(ops.consumeStacks(1)),
          targets.opponentActive.apply(ops.addMark(resolved.get('mark_liuxie')!, { stack: 50 })),
        ),
      }),
    ),
    effect_skill_consume_maimaijinzhen_add_maidijinzhen: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_maimaijinzhen_add_maidijinzhen',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_maimaijinzhen')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_maimaijinzhen').apply(ops.consumeStacks(1)),
          targets.opponentActive.apply(ops.addMark(resolved.get('mark_maidijinzhen')!)),
        ),
      }),
    ),
    effect_skill_consume_maimaijinzhen_heal_self_50: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_maimaijinzhen_heal_self_50',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_maimaijinzhen')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_maimaijinzhen').apply(ops.consumeStacks(1)),
          targets.ownerPet.apply(ops.addMark(resolved.get('mark_huifu_50_per_turn')!, { duration: 5 })),
        ),
      }),
    ),
    effect_skill_consume_opponent_yinbo_add_yinbopingzhang: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_opponent_yinbo_add_yinbopingzhang',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_yinbo')),
          ),
        ),
        apply: actions.sequence(
          targets.ownerPet.apply(
            ops.addMark(resolved.get('mark_yinbopingzhang')!, {
              stack: targets.opponentMarks
                .where(mark => mark.baseId === 'mark_yinbo')
                .select(mark => mark.stack)
                .first(),
            }),
          ),
          targets.opponentMarks.where(mark => mark.baseId === 'mark_yinbo').apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_consume_opponent_yinbo_add_zaoyin: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_opponent_yinbo_add_zaoyin',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_yinbo')),
          ),
        ),
        apply: actions.sequence(
          targets.opponentActive.apply(
            ops.addMark(resolved.get('mark_zaoyin')!, {
              stack: targets.opponentMarks
                .where(mark => mark.baseId === 'mark_yinbo')
                .select(mark => mark.stack)
                .first(),
            }),
          ),
          targets.opponentMarks.where(mark => mark.baseId === 'mark_yinbo').apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_priority_plus_1_consume_shazhidanke: compileEffect(
      defineEffect({
        id: 'effect_skill_priority_plus_1_consume_shazhidanke',
        triggers: [EffectTrigger.BeforeSort],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.property('priority').apply(ops.add(1)),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
  })
}
