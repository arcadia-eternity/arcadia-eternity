import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidateCoverage } from './coverage.mjs'
test('candidate inventory includes standalone handwritten ledgers and does not count rejection records', async () => {
  const result = await candidateCoverage()
  for (const [id, file] of [
    ['effect_mark_curse_add_random_status', 'curse-mark-application'],
    ['effect_skill_set_field_qingtian_or_yemu', 'random-weather-application'],
    ['effect_skill_add_mark_zhaocai_or_jinbao', 'random-mark-applications'],
  ]) {
    assert.ok(result.owners[id].includes(`docs/v4/validation/${file}.json`))
    assert.ok(!result.uncovered.includes(id))
  }
  assert.ok(
    result.owners.effect_ability_enhance_atk_when_spa_enhanced.includes(
      'docs/v4/validation/stat-stages-candidates.json',
    ),
  )
  // The generic generator still rejects this definition; its approved handwritten
  // correction now owns it. A rejection must not appear as another owner.
  assert.deepEqual(result.owners.effect_mark_special_damage_reduction_with_stack, [
    'docs/v4/validation/stack-damage.json',
  ])
  assert.equal(result.covered, 1065)
  assert.deepEqual(result.uncovered, [])
  assert.equal(result.total, result.covered + result.uncovered.length)
  assert.equal(new Set(result.uncovered).size, result.uncovered.length)
})
