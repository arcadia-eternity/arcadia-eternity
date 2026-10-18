import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStatStage, generateStatStages } from './stat-stages.mjs'
const source = () => ({
  id: 'example',
  trigger: 'BeforeHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'statStageBuff', target: { base: 'opponent' }, statType: 'def', value: -1 },
})
const roll = {
  type: 'evaluate',
  target: 'self',
  evaluator: {
    type: 'probability',
    percent: { type: 'raw:number', value: 20, configId: 'chance', tags: ['skill_effect_probability'] },
  },
}
test('preserves ordered nested admission, stable paths and raw parameter metadata', () => {
  const d = source()
  const r = classifyStatStage({
    ...d,
    condition: { type: 'every', conditions: [d.condition, { type: 'every', conditions: [roll, d.condition] }] },
  })
  assert.deepEqual(
    r.clauses.map(c => [c.kind, c.path]),
    [
      ['self', 'condition/0'],
      ['probability', 'condition/1/0'],
      ['self', 'condition/1/1'],
    ],
  )
  assert.equal(r.clauses[1].alias, 'chance')
  assert.deepEqual(r.clauses[1].tags, ['skill_effect_probability'])
  assert.equal(r.value, -1)
})
test('rejects unsupported semantics and ambiguous parameter aliases', () => {
  const d = source()
  for (const bad of [
    { ...d, consumesStacks: 1 },
    { ...d, priority: NaN },
    { ...d, trigger: 'OnDamage' },
    { ...d, trigger: [] },
    { ...d, trigger: ['BeforeHit', 'BeforeHit'] },
    { ...d, condition: { type: 'every', conditions: [] } },
    { ...d, condition: { type: 'every', conditions: [d.condition, roll, roll] } },
    { ...d, apply: { ...d.apply, value: { type: 'raw:number', value: 1 } } },
    { ...d, apply: { ...d.apply, target: { base: 'opponent', chain: [] } } },
    { ...d, apply: { ...d.apply, statType: 'hp' } },
    { ...d, apply: { ...d.apply, value: Infinity } },
    { ...d, condition: { type: 'every', conditions: [d.condition, { ...roll, unexpected: true }] } },
  ])
    assert.ok(classifyStatStage(bad).reason)
})
test('all emitted source and ledger reproduce exactly', async () =>
  assert.deepEqual(await generateStatStages({ check: true }), { generated: 58, parameters: 42, rejected: 44 }))
