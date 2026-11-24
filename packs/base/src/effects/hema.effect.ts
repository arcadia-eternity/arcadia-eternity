import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'
import {
  actions,
  conditions,
  contexts,
  defineEffects,
  EffectTrigger,
  ops,
  selectFrom,
  targets,
} from '@arcadia-eternity/battle/authoring'

const hearing = 'mark_shiqutingjue'
const smell = 'mark_shiquxiujue'
const taste = 'mark_shiquweijue'
const senseLoss = new Set([hearing, smell, taste])

const opponentLostAnySense = targets.opponentActive.condition((_ctx, pets) =>
  pets.some(pet => pet.marks.some(mark => senseLoss.has(mark.baseId))),
)

function opponentLostSense(id: string) {
  return targets.opponentActive.condition((_ctx, pets) => pets.some(pet => pet.marks.some(mark => mark.baseId === id)))
}

@effectGroup({ id: 'hema' })
export class HemaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const lostSenseMarks = [...senseLoss].map(id => {
      const mark = marks.get(id)
      if (!mark || mark.id !== id) throw new Error(`Missing official mark: ${id}`)
      return mark
    })

    return defineEffects({
      effect_skill_add_random_sense_loss_to_opponent: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.opponentActive.apply(ops.addMark(selectFrom(lostSenseMarks).shuffled().first())),
      },
      effect_skill_add_50_power_if_opponent_lost_sense: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentLostAnySense),
        apply: contexts.skillUse.apply(ops.addPower(50)),
      },
      effect_skill_reduce_opponent_spe_1_stage_if_opponent_lost_hearing: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, opponentLostSense(hearing)),
        apply: targets.opponentActive.apply(ops.changeStatStage('spe', -1)),
      },
      effect_skill_raise_self_spe_spd_def_1_stage_for_opponent_sense_losses: {
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          actions.choose(opponentLostSense(hearing), targets.ownerPet.apply(ops.changeStatStage('spe', 1))),
          actions.choose(opponentLostSense(smell), targets.ownerPet.apply(ops.changeStatStage('spd', 1))),
          actions.choose(opponentLostSense(taste), targets.ownerPet.apply(ops.changeStatStage('def', 1))),
        ),
      },
      effect_skill_add_all_sense_losses_to_opponent: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(...lostSenseMarks.map(mark => targets.opponentActive.apply(ops.addMark(mark)))),
      },
      effect_mark_shiqutingjue_attack_sure_hit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_ctx, events) => events.some(event => event.category !== 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      },
      effect_mark_shiquweijue_status_skill_sure_hit: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.ownerIsSkillTarget,
          contexts.skillUse.condition((_ctx, events) => events.some(event => event.category === 'Status')),
        ),
        apply: contexts.skillUse.apply(ops.setSureHit(2)),
      },
      effect_ability_add_rage_5_on_hit_if_opponent_lost_sense: {
        triggers: [EffectTrigger.OnHit],
        // Test the opponent's existing marks before this hit can apply another one.
        priority: 1,
        when: conditions.all(conditions.ownerUsesSkill, opponentLostAnySense),
        apply: targets.ownerPet.apply(ops.addRage(5)),
      },
      effect_emblem_prevent_hearing_loss: {
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.id === hearing)),
        ),
        apply: contexts.addMark.apply(ops.disableContext()),
      },
    })
  }
}
