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
  assert.ok(result.uncovered.includes('effect_mark_special_damage_reduction_with_stack'))
  assert.equal(result.total, result.covered + result.uncovered.length)
  assert.equal(new Set(result.uncovered).size, result.uncovered.length)
})
