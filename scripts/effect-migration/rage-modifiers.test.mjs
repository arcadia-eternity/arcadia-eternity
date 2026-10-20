import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRageModifier, generateRageModifiers } from './rage-modifiers.mjs'
const source = () => ({
  id: 'effect_emblem_increase_rage_on_damage',
  trigger: 'BeforeRageGain',
  priority: 0,
  condition: { type: 'selfBeDamaged' },
  apply: { type: 'addModified', target: 'rageContext', percent: 20, delta: 0 },
})
test('reproduces three historical damage-rage candidates', async () =>
  assert.deepEqual(await generateRageModifiers({ check: true }), { generated: 3, rejected: 0 }))
test('preserves original trigger and pins the historical baseline without source corrections', () => {
  const r = classifyRageModifier(source())
  assert.equal(r.trigger, 'BeforeRageGain')
  assert.equal(r.condition, 'ownerReceivesDamageRage')
  assert.equal(r.percent, 20)
  assert.equal(r.historicalReference, '61c349fa7ca35c392b0e751c9238759b02aefcb3')
  assert.equal(r.corrections, undefined)
})
test('rejects unknown IDs and every changed source semantic', () => {
  for (const change of [
    d => (d.id = 'unknown'),
    d => (d.trigger = 'OnRageGain'),
    d => (d.priority = 1),
    d => (d.condition.type = 'checkSelf'),
    d => (d.apply.percent = 21),
    d => (d.apply.delta = 1),
    d => (d.apply.target = 'damageContext'),
    d => (d.extra = true),
  ]) {
    const d = source()
    change(d)
    assert.ok(classifyRageModifier(d).reason)
  }
})
