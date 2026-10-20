import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAttributeContributions, generateAttributeContributions } from './attribute-contributions.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnMarkCreated',
  priority: 0,
  apply: { type: 'addAttributeModifier', target: 'self', stat: 'spe', modifierType: 'delta', value: 5 },
})
test('reproduces all twenty-one contributions including explicit live binding', async () =>
  assert.deepEqual(await generateAttributeContributions({ check: true }), { generated: 21, rejected: 0 }))
test('keeps stat identity and missing conditions', () => {
  const r = classifyAttributeContributions(source())
  assert.equal(r.when, '() => true')
  assert.match(r.actions[0].code, /"spe","delta",5/)
})
test('rejects unsupported phase scopes, attributes, operations and unsupported live reads', () => {
  for (const mutate of [
    d => (d.apply.phaseType = 'turn'),
    d => (d.apply.stat = 'foo'),
    d => (d.apply.modifierType = 'foo'),
    d =>
      (d.apply.value = {
        type: 'dynamic',
        selector: { base: 'mark', chain: [{ type: 'selectAttribute$', arg: 'currentHp' }] },
      }),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyAttributeContributions(d).reason)
  }
})

test('rejects malformed skill chains without throwing', () => {
  for (const chain of [
    null,
    undefined,
    {
      length: 1,
      0: {
        type: 'whereAttr',
        extractor: { type: 'base', arg: 'baseId' },
        evaluator: { type: 'same', value: 'skill_x' },
      },
    },
  ]) {
    const d = source()
    d.apply.target = { base: 'selfSkills', chain }
    d.apply.stat = 'accuracy'
    assert.ok(classifyAttributeContributions(d).reason)
  }
})

test('live contributions in a sequence have distinct declared binding keys', async () => {
  const { sequenceAction } = await import('./sequence-actions.mjs')
  const a = source().apply
  a.value = {
    type: 'dynamic',
    selector: {
      base: 'mark',
      chain: [
        { type: 'selectAttribute$', arg: 'stack' },
        { type: 'multiply', arg: { type: 'raw:number', configId: 'factor', value: 20 } },
      ],
    },
  }
  const first = sequenceAction(a, 'OnHit', 'skill', [], 'action1_value')
  const second = sequenceAction(a, 'OnHit', 'skill', [], 'action2_value')
  assert.match(first, /key:"action1_value_binding"/)
  assert.match(second, /key:"action2_value_binding"/)
})
