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
      d.trigger = 'OnStack'
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
test('reproduces thirteen vital candidates and six unsupported lists', async () =>
  assert.deepEqual(await generateVitalSequences({ check: true }), { generated: 13, rejected: 6 }))

test('turn-end and damage queries retain their distinct admission and value sources', () => {
  const d = source()
  d.trigger = 'TurnEnd'
  d.condition = { type: 'petIsActive' }
  assert.equal(classifyVitalSequence(d).when, 'conditions.ownerIsActive')
  d.trigger = 'OnDamage'
  d.condition = { type: 'selfBeDamaged' }
  d.apply = [
    {
      type: 'dealDamage',
      target: 'opponent',
      value: {
        type: 'dynamic',
        selector: {
          base: 'damageContext',
          chain: [
            { type: 'selectPath', arg: 'damageResult' },
            { type: 'divide', arg: 4 },
          ],
        },
      },
    },
  ]
  const r = classifyVitalSequence(d)
  assert.equal(r.when, 'conditions.selfBeDamaged')
  assert.match(r.actions[0].code, /contexts.damage.select.*damageResult.*Math.floor/)
})
