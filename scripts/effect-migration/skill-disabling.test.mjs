import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySkillDisabling, generateSkillDisabling } from './skill-disabling.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'BeforeUseSkillCheck',
  priority: 0,
  condition: { type: 'checkSelf' },
  apply: { type: 'stun', target: 'useSkillContext' },
})
test('reproduces all four disabling candidates', async () =>
  assert.deepEqual(await generateSkillDisabling({ check: true }), { generated: 4, rejected: 0 }))
test('records C07 and reuses the cancellation operation', () => {
  const result = classifySkillDisabling(source())
  assert.deepEqual(result.repairedPaths, ['/apply/target'])
  assert.equal(result.when, 'conditions.sourceOwnsEvent')
  assert.equal(result.actions[0].code, 'contexts.skillUse.apply(ops.disableContext())')
})
test('rejects wrong events, targets and additional fields', () => {
  for (const mutate of [
    d => (d.trigger = 'OnHit'),
    d => (d.apply.target = 'damageContext'),
    d => (d.apply.value = 0),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifySkillDisabling(d).reason)
  }
})
