import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDynamicContributions, generateDynamicContributions } from './dynamic-contributions.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnMarkCreated',
  priority: 0,
  apply: {
    type: 'addDynamicAttributeModifier',
    target: { base: 'self' },
    stat: 'spe',
    modifierType: 'delta',
    observableValue: {
      base: 'mark',
      chain: [
        { type: 'selectAttribute$', arg: 'stack' },
        { type: 'multiply', arg: -25 },
      ],
    },
  },
})
test('emits ten source-stack candidates and retains the existing weakness selector candidate', async () =>
  assert.deepEqual(await generateDynamicContributions({ check: true }), { generated: 10, rejected: 0, retained: 1 }))
test('preserves capture, follow, floor and independent append semantics', () => {
  const code = classifyDynamicContributions(source()).actions[0].code
  assert.match(code, /capture\(\{key:"source",scope:"binding"\}\)/)
  assert.match(code, /follow\(\{key:"stack"\}\)/)
  assert.match(code, /Math.floor\(stack\*-25\)/)
  assert.match(code, /stacking:"append"/)
})
test('rejects unsupported target, phase scope, chain shape and attributes', () => {
  for (const mutate of [
    d => (d.apply.target = 'opponent'),
    d => (d.apply.phaseType = 'turn'),
    d => (d.apply.observableValue.chain = null),
    d => (d.apply.observableValue.chain[1] = null),
    d => (d.apply.observableValue.chain[0].arg = 'duration'),
    d => (d.apply.observableValue.chain[1].type = 'divide'),
    d => (d.apply.observableValue.base = 'selfMarks'),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyDynamicContributions(d).reason)
  }
})
