import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyIgnoreShield, generateIgnoreShield } from './ignore-shield.mjs'
const source = () => ({
  id: 'example',
  trigger: 'AfterUseSkillCheck',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'setIgnoreShield', target: 'useSkillContext' },
})
test('reproduces the historical shield bypass candidate', async () =>
  assert.deepEqual(await generateIgnoreShield({ check: true }), { generated: 1, rejected: 0 }))
test('uses the shared context query for both historical selector spellings', () => {
  for (const target of ['useSkillContext', 'usingSkillContext']) {
    const d = source()
    d.apply.target = target
    assert.equal(classifyIgnoreShield(d).actions[0].code, 'contexts.skillUse.apply(ops.setIgnoreShield())')
  }
})
test('rejects unsupported targets, flag values and stages', () => {
  for (const change of [
    d => (d.apply.target = 'selfSkills'),
    d => (d.apply.value = false),
    d => (d.trigger = 'OnHit'),
  ]) {
    const d = source()
    change(d)
    assert.ok(classifyIgnoreShield(d).reason)
  }
})
