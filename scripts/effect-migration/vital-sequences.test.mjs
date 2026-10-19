import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyVitalSequence, generateVitalSequences } from './vital-sequences.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: [
    { type: 'heal', target: 'self', value: 3 },
    { type: 'destroyMark', target: 'mark' },
  ],
})
test('vital sequences preserve full ordered actions', () =>
  assert.deepEqual(classifyVitalSequence(source()).actions, [
    { sourcePath: '/apply/0', code: 'targets.ownerPet.apply(ops.heal(3))' },
    { sourcePath: '/apply/1', code: 'targets.sourceMark.apply(ops.removeMark())' },
  ]))
test('rejects unsupported whole lists rather than dropping fields', () => {
  for (const mutate of [
    d => {
      d.apply[0].value = Infinity
    },
    d => {
      d.apply[0].target = 'selfPlayer'
    },
    d => {
      d.apply.push({ type: 'unknown' })
    },
    d => {
      d.trigger = 'OnDamage'
    },
    d => {
      d.apply[0].extra = 1
    },
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyVitalSequence(d).reason)
  }
})
test('keeps raw numeric parameters as editable authored parameters', () => {
  const d = source()
  d.apply[0].value = { type: 'raw:number', value: 3, configId: 'amount', tags: ['heal'] }
  const r = classifyVitalSequence(d)
  assert.deepEqual(r.parameters, [{ name: 'action0_value', value: 3, configId: 'amount', tags: ['heal'] }])
  assert.match(r.actions[0].code, /parameters.action0_value/)
})
test('reproduces six OnHit candidates and thirteen unsupported lists', async () =>
  assert.deepEqual(await generateVitalSequences({ check: true }), { generated: 6, rejected: 13 }))
