import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRageAssignment, generateRageAssignment } from './rage-assignment.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnSwitchOut',
  priority: 0,
  condition: { type: 'selfSwitchOut' },
  apply: { type: 'setRage', target: 'self', value: 0 },
})
test('reproduces all four historical rage assignment candidates', async () =>
  assert.deepEqual(await generateRageAssignment({ check: true }), { generated: 4, rejected: 0 }))
test('maps the switch event with its own context condition', () => {
  const r = classifyRageAssignment(source())
  assert.equal(r.when, 'conditions.ownerSwitchesOut')
  assert.equal(r.actions[0].code, 'targets.ownerPet.apply(ops.setRage(0))')
})
test('rejects unsupported assignment targets and unrelated trigger lists', () => {
  for (const change of [
    d => (d.apply.target = 'selfSkills'),
    d => (d.trigger = ['OnHit', 'TurnStart']),
    d => (d.apply.extra = true),
  ]) {
    const d = source()
    change(d)
    assert.ok(classifyRageAssignment(d).reason)
  }
})
