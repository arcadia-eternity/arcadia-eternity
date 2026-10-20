import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMarkRemoval, generateMarkRemovals } from './mark-removals.mjs'
const source = () => ({
  id: 'test',
  trigger: 'PostDamage',
  priority: 0,
  condition: { type: 'selfBeDamaged' },
  apply: { type: 'destroyMark', target: 'mark' },
})
test('reproduces all thirteen single mark removals', async () =>
  assert.deepEqual(await generateMarkRemovals({ check: true }), { generated: 13, rejected: 0 }))
test('keeps damage ownership, source identity and exact action paths', () => {
  const r = classifyMarkRemoval(source())
  assert.ok(!r.reason, r.reason)
  assert.equal(r.when, 'conditions.selfBeDamaged')
  assert.deepEqual(r.actions, [{ sourcePath: '/apply', code: 'targets.sourceMark.apply(ops.removeMark())' }])
})
test('supports critical post-damage and exact hit/miss pair only', () => {
  for (const trigger of ['OnCritPostDamage', ['OnHit', 'OnMiss']]) {
    const d = source()
    d.trigger = trigger
    delete d.condition
    assert.ok(!classifyMarkRemoval(d).reason)
  }
  for (const mutate of [
    d => (d.trigger = ['PostDamage', 'OnHit']),
    d => (d.apply = [d.apply]),
    d => (d.apply.extra = true),
    d => (d.apply.target = { base: 'selfMarks', chain: [{ type: 'unknown' }] }),
    d => (d.condition = null),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyMarkRemoval(d).reason)
  }
})
