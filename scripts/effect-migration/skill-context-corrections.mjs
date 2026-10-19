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
  for (const [path, before, after] of corrections) {
    const keys = path.slice(1).split('/')
    const key = keys.pop()
    const parent = keys.reduce((value, part) => value?.[part], copy)
    if (parent?.[key] !== before || parent.type !== 'selectPath') return { reason: `C09 source node changed: ${path}` }
    parent[key] = after
    changes.push({ path, before, after })
  }
  return { definition: copy, changes }
}
