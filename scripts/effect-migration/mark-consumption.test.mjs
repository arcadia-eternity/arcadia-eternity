import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMarkConsumption, generateMarkConsumption } from './mark-consumption.mjs'
const source = () => ({
  id: 'test',
  trigger: 'OnHit',
  priority: -50,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'consumeStacks', target: { base: 'opponentMarks', chain: [] }, value: 2 },
})
test('reproduces seven independent stack consumption effects', async () =>
  assert.deepEqual(await generateMarkConsumption({ check: true }), { generated: 7, rejected: 0 }))
test('preserves finite consumption amount and opponent target query', () => {
  const r = classifyMarkConsumption(source())
  assert.ok(!r.reason, r.reason)
  assert.deepEqual(r.actions, [{ sourcePath: '/apply', code: 'targets.opponentMarks.apply(ops.consumeStacks(2))' }])
  assert.equal(r.priority, -50)
})
test('rejects changed actions, stages and unsupported amounts without dropping them', () => {
  for (const mutate of [
    d => (d.trigger = 'TurnEnd'),
    d => (d.apply = [d.apply]),
    d => (d.apply.value = { type: 'dynamic', selector: 'mark' }),
    d => (d.apply.extra = true),
    d => (d.condition = null),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyMarkConsumption(d).reason)
  }
})
