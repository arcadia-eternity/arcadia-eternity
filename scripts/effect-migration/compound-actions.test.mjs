import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCompoundActions, generateCompoundActions } from './compound-actions.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: [
    {
      type: 'addMark',
      target: 'self',
      mark: {
        type: 'conditional',
        condition: { type: 'selfHasMark', baseId: 'mark_test' },
        trueValue: { type: 'entity:baseMark', value: 'mark_a' },
        falseValue: { type: 'entity:baseMark', value: 'mark_b' },
      },
      stack: 50,
    },
    { type: 'destroyMark', target: 'mark' },
  ],
})
test('reproduces 34 ordered candidates, two unresolved definitions and ten retained owners', async () =>
  assert.deepEqual(await generateCompoundActions({ check: true }), { generated: 34, rejected: 2, retained: 10 }))
test('keeps conditional mark reads and option reads inside their ordered action', () => {
  const r = classifyCompoundActions(source())
  assert.deepEqual(r.markDependencies, ['mark_a', 'mark_b'])
  assert.match(r.actions[0].code, /values.choose/)
  assert.match(r.actions[0].code, /stack:50/)
  assert.match(r.actions[1].code, /removeMark/)
})
test('rejects unknown nested mark fields and unsupported options', () => {
  for (const mutate of [
    d => (d.apply[0].mark.trueValue.extra = true),
    d => (d.apply[0].extra = true),
    d => (d.apply[0].stack = null),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyCompoundActions(d).reason)
  }
})
