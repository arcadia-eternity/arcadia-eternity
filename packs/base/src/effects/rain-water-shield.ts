import {
  compileEffect,
  conditions,
  contexts,
  defineEffect,
  ops,
  targets,
  values,
} from '@arcadia-eternity/battle/v4/authoring'
import type { ParameterCatalog } from '@arcadia-eternity/battle/v4'

/** C09 maps the skillId lookup to the skill instance; weather is queried at action time. */
export function createRainWaterShield(catalog: ParameterCatalog) {
  return compileEffect(
    defineEffect({
      id: 'effect_ability_add_shuiwenpingzhang_value_if_yutian',
      on: 'BeforeHit',
      priority: 0,
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_ctx, events) =>
          events.some(event => event.skill.baseId === 'skill_shuiwenpingzhang'),
        ),
      ),
      execute: targets.ownerPet.apply(
        ops.setParameter(
          catalog,
          'effect_skill_add_mark_shuiwenpingzhang.multiply_value',
          values.choose(
            contexts.battle.condition((_ctx, battles) =>
              battles.some(battle => battle.marks.some(mark => mark.baseId === 'mark_global_yutian')),
            ),
            1.5,
            1,
          ),
        ),
      ),
    }),
  )
}
