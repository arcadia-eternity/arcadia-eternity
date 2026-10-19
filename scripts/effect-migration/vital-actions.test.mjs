import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyVitalAction, generateVitalActions } from './vital-actions.mjs'
const source = () => ({
  id: 'test',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: {
    type: 'heal',
    target: 'self',
    value: {
      type: 'dynamic',
      selector: {
        base: 'self',
        chain: [
          { type: 'select', arg: { type: 'base', arg: 'maxHp' } },
          { type: 'divide', arg: 8 },
        ],
      },
    },
  },
})
test('single actions retain their source path and reuse typed numeric operations', () => {
  const r = classifyVitalAction(source())
  assert.ok(!r.reason, r.reason)
  assert.equal(r.actions[0].sourcePath, '/apply')
  assert.match(r.actions[0].code, /ops.heal.*Math.floor\(n \/ 8\)/)
})
test('rejects lists and unsupported single definitions without dropping data', () => {
  for (const mutate of [
    d => (d.apply = [d.apply]),
    d => (d.apply.extra = true),
    d => (d.apply.value.selector.chain[1].arg = { type: 'raw:number', value: 8 }),
    d => (d.trigger = 'OnMarkDurationEnd'),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyVitalAction(d).reason)
  }
})
test('preserves existing ownership while reproducing current single vital candidates', async () =>
  assert.deepEqual(await generateVitalActions({ check: true }), { generated: 30, rejected: 20, retained: 27 }))

test('retained entries preserve all existing provenance ledgers', async () => {
  const { readFile } = await import('node:fs/promises')
  const ledger = JSON.parse(await readFile('docs/v4/validation/vital-actions-candidates.json', 'utf8'))
  assert.deepEqual(ledger.retained.find(r => r.id === 'effect_skill_heal_self_90_hp').ownerLedgers, [
    'docs/v4/validation/instant-literals-candidates.json',
    'docs/v4/validation/official-healing-candidates.json',
  ])
})
