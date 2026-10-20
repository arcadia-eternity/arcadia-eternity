import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyContextControls, generateContextControls } from './context-controls.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'BeforeHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'setIgnoreStageStrategy', target: 'useSkillContext', value: 'positive' },
})
test('reproduces five context control candidates', async () =>
  assert.deepEqual(await generateContextControls({ check: true }), { generated: 5, rejected: 0 }))
test('records the selector spelling repair and preserves stage strategy', () => {
  const result = classifyContextControls(source())
  assert.deepEqual(result.repairedPaths, ['/apply/target'])
  assert.match(result.actions[0].code, /setIgnoreStageStrategy\("positive"\)/)
})
test('rejects unsupported strategy, target and operation fields', () => {
  for (const mutate of [
    d => (d.apply.value = 'unknown'),
    d => (d.apply.target = 'damageContext'),
    d => (d.apply.priority = 1),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyContextControls(d).reason)
  }
})
