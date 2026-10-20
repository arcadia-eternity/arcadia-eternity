import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDamageThresholds, generateDamageThresholds } from './damage-thresholds.mjs'
const source = () => ({
  id: 'test',
  trigger: 'OnBeforeCalculateDamage',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addThreshold', target: 'damageContext', min: 95 },
})
test('reproduces five damage threshold candidates', async () =>
  assert.deepEqual(await generateDamageThresholds({ check: true }), { generated: 5, rejected: 0 }))
test('distinguishes omitted literal-zero from explicit configurable-zero bounds', () => {
  const d = source()
  d.apply.min = 0
  assert.equal(classifyDamageThresholds(d).actions[0].code, 'contexts.damage.apply(ops.setDamageThreshold({}))')
  d.apply.min = { type: 'raw:number', value: 0 }
  const r = classifyDamageThresholds(d)
  assert.ok(!r.reason, r.reason)
  assert.equal(r.parameters[0].value, 0)
  assert.match(r.actions[0].code, /min:parameters.action0_value_min/)
})
test('rejects unsupported threshold shapes and stages', () => {
  for (const mutate of [
    d => (d.trigger = 'OnHit'),
    d => (d.apply.extra = true),
    d => (d.apply.min = null),
    d => (d.apply.max = Infinity),
    d => (d.apply.target = 'self'),
    d => (d.apply = [d.apply]),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyDamageThresholds(d).reason)
  }
})
