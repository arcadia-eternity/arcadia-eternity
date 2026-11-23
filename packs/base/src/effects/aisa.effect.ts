import {
  actions,
  conditions,
  contexts,
  DamageType,
  defineEffects,
  EffectTrigger,
  ops,
  targets,
} from '@arcadia-eternity/battle/authoring'
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

const CAIXIAZHIXIN = 'mark_caixiazhixin'
const XUANGUANGQIDIAN = 'mark_xuanguangqidian'
const SHIMING = 'mark_shiming'

const caixiazhixin = targets.ownerMarks.where(mark => mark.baseId === CAIXIAZHIXIN && mark.isActive)
const hasCaixiazhixin = caixiazhixin.condition((_, marks) => marks.length > 0)

const critDamage = contexts.damage.condition((_, events) =>
  events.some(
    event => event.crit && (event.damageType === DamageType.Physical || event.damageType === DamageType.Special),
  ),
)

const critHeal = (fraction: number) => {
  const healAmount = targets.ownerPet.select(pet => Math.floor(pet.stat.maxHp * fraction)).first()
  return {
    triggers: [EffectTrigger.OnDamage] as const,
    priority: 0,
    when: conditions.all(conditions.selfUsesSkill, critDamage),
    apply: targets.ownerPet.apply(ops.heal(healAmount)),
  }
}

const critRage = (amount: number) => ({
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, critDamage),
  apply: targets.ownerPet.apply(ops.addRage(amount)),
})

const critBlind = (shimingMark: Parameters<typeof ops.addMark>[0]) => ({
  triggers: [EffectTrigger.OnDamage] as const,
  priority: 0,
  when: conditions.all(conditions.selfUsesSkill, critDamage, conditions.chance(50)),
  apply: targets.opponentActive.apply(ops.addMark(shimingMark)),
})

@effectGroup({ id: 'aisa' })
export class AisaEffects {
  static build({ marks }: Pick<EffectLoadingContext, 'marks'>) {
    const caixiazhixinMark = marks.get(CAIXIAZHIXIN)
    const xuanguangqidianMark = marks.get(XUANGUANGQIDIAN)
    const shimingMark = marks.get(SHIMING)
    if (!caixiazhixinMark || !xuanguangqidianMark || !shimingMark) {
      throw new Error('Missing caixiazhixin, xuanguangqidian, or shiming mark')
    }

    return defineEffects({
      effect_aisa_ability_crit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addCritRate(5)),
      },
      effect_aisa_emblem_accuracy: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, hasCaixiazhixin),
        apply: contexts.skillUse.apply(ops.addAccuracy(5)),
      },
      effect_aisa_skill_caixiazhixin: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(caixiazhixinMark, { stack: 1 })),
      },
      effect_aisa_skill_xuancaiguangshu: critHeal(0.16),
      effect_aisa_skill_xuancaibaopo: critRage(15),
      effect_aisa_skill_xuancaishanguang: critBlind(shimingMark),
      effect_aisa_skill_huancaiguangyun: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: actions.sequence(
          actions.choose(conditions.chance(15), targets.ownerPet.apply(ops.changeStatStage('atk', 1))),
          actions.choose(conditions.chance(15), targets.ownerPet.apply(ops.changeStatStage('spa', 1))),
        ),
      },
      effect_aisa_skill_xuanguangqidian: {
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: targets.ownerPet.apply(ops.addMark(xuanguangqidianMark, { stack: 1 })),
      },
      effect_aisa_skill_xuanguangbaopo: critRage(20),
      effect_mark_caixiazhixin_crit: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(ops.addCritRate(targets.sourceMark.select(mark => mark.stack).first())),
      },
      effect_mark_xuanguangqidian_critdmg: {
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.damage.condition((_, hits) => hits.some(hit => hit.crit)),
        ),
        apply: contexts.damage.apply(
          ops.modifyDamage({ percent: targets.sourceMark.select(mark => mark.stack * 50).first(), delta: 0 }),
        ),
      },
    })
  }
}
