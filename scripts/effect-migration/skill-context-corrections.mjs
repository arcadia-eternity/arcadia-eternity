/** C07: explicit selector spelling repair on a copy; records every changed source node. */
export function repairSkillSelector(definition) {
  const paths = []
  function visit(v, path = '') {
    if (Array.isArray(v)) return v.map((x, i) => visit(x, `${path}/${i}`))
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          const next = `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`
          if (['base', 'target'].includes(k) && x === 'useSkillContext') {
            paths.push(next)
            return [k, 'usingSkillContext']
          }
          return [k, visit(x, next)]
        }),
      )
    return v
  }
  return { definition: visit(definition), paths }
}
// C09 is deliberately limited to these source nodes; unknown paths are never guessed.
const skillPathCorrections = {
  effect_skill_add_damage_spa_sixth: [['/apply/delta/selector/chain/0/arg/arg', 'spa', 'stat.spa', 'dynamic']],
  effect_skill_fixed_damage_with_qianggong_stack_if_atk_over_500: [
    ['/condition/conditions/1/target/chain/0/arg', 'atk', 'stat.atk'],
  ],
  effect_ability_add_damage_40_if_using_yutu_skill: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_emblem_increase_quan_skill_damage_5_percent: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_emblem_zhongji_damage_boost_35_percent: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_mark_hongbaoshizhiguang_add_200_fixed_damage: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_mark_lanbaoshizhiguang_add_200_fixed_damage: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_mark_jiguang_add_200_damage: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_mark_jueying_add_200_damage: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],

  effect_mark_shandianluoyin_paralyze: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_skill_priority_plus_1_if_atk_over_500: [['/condition/conditions/1/target/chain/0/arg', 'atk', 'stat.atk']],
  effect_ability_shenguang_immune_status_above_half_hp: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark'],
  ],
  effect_ability_immune_exceptional_if_rage_gt_50: [
    ['/condition/conditions/2/target/chain/0/arg', 'baseMarkId', 'baseMark'],
  ],
  effect_emblem_immune_mark_zhixi: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_immune_mark_haipa: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_mark_immune_status: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark']],
  effect_mark_immune_exceptional: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark']],
  effect_mark_immune_zhongdu: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_anying_immune_fear_early_wake: [
    ['/condition/conditions/1/target/chain/0/arg', 'effectId', 'effect.id'],
  ],
  effect_emblem_set_zhongdu_duration_2: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_decrease_liuxie_duration_1: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_decrease_shiming_duration_1: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_add_manxingduyao_maxstack_4: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_add_xingzhili_duration: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_add_shaoshang_duration: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_add_xuanyun_duration: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_add_mark_yanhuo_duration_1: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_add_zhenjiu_duration_1: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_dadiqiang_duration_boost_1: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_shazhidanke_max_stack_4: [['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id']],
  effect_emblem_yaoling_extend_zhaocai_jinbao_duration: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_extend_bizhong_duration_5: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_increase_huohuanzhixin_maxstacks_4: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_emblem_increase_leishenjuexing_duration_1: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_mark_double_mark_yanhuo_duration: [
    ['/condition/conditions/1/target/chain/0/arg', 'baseMarkId', 'baseMark.id'],
  ],
  effect_mark_shuangrenzhan_add_2_hits: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_mark_shuangpozhan_add_2_hits: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_emblem_add_rage_5_when_use_feixuanzhiguang: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_skill_deal_damage_spa_sixth_on_miss: [['/apply/value/selector/chain/0/arg/arg', 'spa', 'stat.spa', 'dynamic']],
  effect_skill_heal_self_def_quarter_hit_or_miss: [
    ['/apply/value/selector/chain/0/arg/arg', 'def', 'stat.def', 'dynamic'],
  ],
  effect_mark_baiyapo_add_damage_based_on_stack: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_mark_heiyapao_add_damage_based_on_stack: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_mark_self_damage_25_percent: [['/condition/conditions/2/target/chain/0/arg', 'sourceId', 'source']],
  effect_mark_self_damage_50_percent_once: [['/condition/conditions/2/target/chain/0/arg', 'sourceId', 'source']],
  effect_mark_self_damage_50_percent_once_when_special: [
    ['/condition/conditions/2/target/chain/0/arg', 'sourceId', 'source'],
  ],
  effect_mark_next_non_status_skill_sure_crit: [['/condition/conditions/2/target/chain/0/arg', 'skillId', 'skill']],
  effect_emblem_immune_skill_bandao: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_skill_sure_hit_if_atk_over_500: [['/condition/conditions/1/target/chain/0/arg', 'atk', 'stat.atk']],
  effect_skill_sure_hit_if_opponent_spa_gt_atk: [
    ['/condition/conditions/1/target/chain/0/arg', 'spa', 'stat.spa'],
    ['/condition/conditions/1/evaluator/value/selector/chain/0/arg', 'atk', 'stat.atk'],
  ],
  effect_ability_enhance_atk_when_spa_enhanced: [['/apply/value/selector/chain/0/arg', 'statLevelMarkLevel', 'stack']],
  effect_emblem_raise_spd_1_stage_when_baonuan_20_percent: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_emblem_raise_spd_1_stage_when_rouruan_20_percent: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_ability_add_mark_opponent_xifamihuo_if_using_xifa_skill: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_emblem_add_mark_fenshenhying_when_use_fenshenshu: [
    ['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill'],
  ],
  effect_ability_amplify_power_consume_ruodian: [['/condition/conditions/2/target/chain/0/arg', 'skillId', 'skill']],
  effect_mark_amplify_non_yanggong: [['/condition/conditions/2/target/chain/0/arg', 'skillId', 'skill']],
  effect_skill_add_power_35_if_opponent_spa_gt_atk: [
    ['/condition/conditions/1/target/chain/0/arg', 'spa', 'stat.spa'],
    ['/condition/conditions/1/evaluator/value/selector/chain/0/arg', 'atk', 'stat.atk'],
  ],
}
export function repairSkillPaths(definition) {
  const copy = structuredClone(definition)
  const changes = []
  const corrections = Object.hasOwn(skillPathCorrections, definition.id) ? skillPathCorrections[definition.id] : []
  for (const [path, before, after, expectedType = 'selectPath'] of corrections) {
    const keys = path.slice(1).split('/')
    const key = keys.pop()
    const parent = keys.reduce((value, part) => value?.[part], copy)
    if (
      parent?.[key] !== before ||
      parent.type !== expectedType ||
      (expectedType === 'dynamic' && keys.slice(0, -1).reduce((value, part) => value?.[part], copy)?.type !== 'select')
    )
      return { reason: `C09 source node changed: ${path}` }
    parent[key] = after
    changes.push({ path, before, after })
  }
  return { definition: copy, changes }
}
