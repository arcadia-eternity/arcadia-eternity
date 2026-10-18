import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMarkApplication, generateMarkApplications } from './mark-applications.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addMark', target: 'self', mark: { type: 'entity:baseMark', value: 'mark/example' }, stack: 2 },
})
test('recognizes exact fixed dependencies and preserves the old zero-as-omitted behavior', () => {
  assert.equal(classifyMarkApplication(source()).markId, 'mark/example')
  assert.equal(classifyMarkApplication(source()).stack, 2)
  const zero = source()
  zero.apply.stack = 0
  zero.apply.duration = 0
  assert.equal(classifyMarkApplication(zero).stack, undefined)
  assert.equal(classifyMarkApplication(zero).duration, undefined)
  assert.deepEqual(classifyMarkApplication({ ...source(), trigger: ['OnHit', 'OnMiss'] }).triggers, ['OnHit', 'OnMiss'])
})
test('rejects extra semantics rather than silently dropping them', () => {
  const d = source()
  for (const invalid of [
    { ...d, consumesStacks: 1 },
    { ...d, trigger: 'OnDamage' },
    { ...d, trigger: ['OnHit', 'OnHit'] },
    { ...d, priority: NaN },
    { ...d, condition: { type: 'every', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] } },
    { ...d, apply: { ...d.apply, config: { duration: 1 } } },
    { ...d, apply: { ...d.apply, stack: { type: 'raw:number', value: 2 } } },
    { ...d, apply: { ...d.apply, duration: Infinity } },
    { ...d, apply: { ...d.apply, target: 'selfTeam' } },
    { ...d, apply: { ...d.apply, mark: { ...d.apply.mark, configId: 'dynamic' } } },
  ])
    assert.ok(classifyMarkApplication(invalid).reason)
})
test('regenerates the exact current native source and dependency ledger without writes', async () => {
  assert.deepEqual(await generateMarkApplications({ check: true }), {
    generated: 173,
    protected: 0,
    dependencies: 152,
    rejected: 114,
  })
})
