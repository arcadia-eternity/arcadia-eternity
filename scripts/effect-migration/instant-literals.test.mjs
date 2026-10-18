import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyInstantLiteral, generateInstantLiterals } from './instant-literals.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addRage', target: 'opponent', value: -20 },
})
test('recognizes finite literal action contracts and supported trigger arrays', () => {
  assert.equal(classifyInstantLiteral(source()).value, -20)
  assert.deepEqual(classifyInstantLiteral({ ...source(), trigger: ['OnHit', 'OnMiss'] }).triggers, ['OnHit', 'OnMiss'])
})
test('refuses unknown fields, dynamic values, extra conditions and unsupported trigger semantics', () => {
  const data = source()
  for (const invalid of [
    { ...data, consumesStacks: 1 },
    { ...data, priority: Infinity },
    { ...data, trigger: 'OnDamage' },
    { ...data, trigger: ['OnHit', 'OnHit'] },
    { ...data, condition: { type: 'every', conditions: [data.condition, { type: 'probability', percent: 50 }] } },
    { ...data, apply: { ...data.apply, extra: true } },
    { ...data, apply: { ...data.apply, value: { type: 'raw:number', value: 20 } } },
    { ...data, apply: { ...data.apply, value: NaN } },
    { ...data, apply: { ...data.apply, target: 'selfTeam' } },
  ])
    assert.ok(classifyInstantLiteral(invalid).reason)
})
test('committed source and ledger exactly reproduce without writes', async () => {
  const result = await generateInstantLiterals({ check: true })
  assert.ok(result.generated > 0)
  assert.equal(result.protected, 1)
  assert.ok(result.rejected > 0)
})
