import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyConditionalActions, generateConditionalActions } from './conditional-actions.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: {
    type: 'conditional',
    condition: { type: 'selfHasMark', baseId: 'mark_test' },
    trueOperator: { type: 'addMark', target: 'opponent', mark: { type: 'entity:baseMark', value: 'mark_mabi' } },
    falseOperator: { type: 'statStageBuff', target: 'self', statType: 'spa', value: 1 },
  },
})
test('reproduces all 24 conditional candidates', async () =>
  assert.deepEqual(await generateConditionalActions({ check: true }), { generated: 24, rejected: 0 }))
test('emits lazy arms and collects explicit mark dependencies', () => {
  const r = classifyConditionalActions(source())
  assert.match(r.actions[0].code, /actions.choose/)
  assert.deepEqual(r.markDependencies, ['mark_mabi'])
})
test('rejects malformed branches and unsupported nested actions', () => {
  for (const mutate of [
    d => (d.apply.falseOperator = null),
    d => (d.apply.trueOperator.extra = true),
    d => (d.apply.trueOperator.type = 'unknown'),
    d => (d.apply.extra = true),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyConditionalActions(d).reason)
  }
})
