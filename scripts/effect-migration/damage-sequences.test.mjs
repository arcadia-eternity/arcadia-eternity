import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDamageSequence, generateDamageSequences } from './damage-sequences.mjs'
const source = () => ({
  id: 'test',
  trigger: 'OnBeforeCalculateDamage',
  priority: 0,
  condition: { type: 'selfBeDamaged' },
  apply: [
    { type: 'addModified', target: 'damageContext', percent: -15, delta: 0 },
    { type: 'destroyMark', target: 'mark' },
  ],
})
test('emits full damage actions in order', () => {
  const r = classifyDamageSequence(source())
  assert.ok(!r.reason, r.reason)
  assert.equal(r.when, 'conditions.selfBeDamaged')
  assert.deepEqual(
    r.actions.map(a => a.code),
    ['contexts.damage.apply(ops.modifyDamage({percent:-15,delta:0}))', 'targets.sourceMark.apply(ops.removeMark())'],
  )
})
test('vital lists have one owning catalog', () => {
  for (const type of ['heal', 'dealDamage', 'addRage']) {
    const d = source()
    d.apply.push({ type, target: 'self', value: 1 })
    assert.match(classifyDamageSequence(d).reason, /another sequence catalog/)
  }
})
test('rejects unknown actions and unsupported conditional inputs', () => {
  for (const mutate of [
    d => d.apply.push({ type: 'unknown' }),
    d => (d.apply[0].percent = { type: 'conditional', condition: { type: 'checkSelf' }, trueValue: 1, falseValue: 2 }),
    d => (d.apply[0].extra = true),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyDamageSequence(d).reason)
  }
})
test('reproduces fifteen damage lists', async () =>
  assert.deepEqual(await generateDamageSequences({ check: true }), { generated: 15, rejected: 0 }))
