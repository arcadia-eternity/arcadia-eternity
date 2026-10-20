import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMarkStackGains, generateMarkStackGains } from './mark-stack-gains.mjs'
const source = () => ({
  id: 'test',
  trigger: 'OnDamage',
  priority: 0,
  condition: { type: 'selfBeDamaged' },
  apply: {
    type: 'addStacks',
    target: 'mark',
    value: {
      type: 'dynamic',
      selector: {
        base: 'damageContext',
        chain: [
          { type: 'selectPath', arg: 'damageResult' },
          { type: 'multiply', arg: 0.5 },
        ],
      },
    },
  },
})
test('reproduces both direct stack gain candidates', async () =>
  assert.deepEqual(await generateMarkStackGains({ check: true }), { generated: 2, rejected: 0 }))
test('emits execution-time damageResult with floor before direct stack addition', () => {
  const r = classifyMarkStackGains(source())
  assert.ok(!r.reason, r.reason)
  assert.equal(r.when, 'conditions.selfBeDamaged')
  assert.match(
    r.actions[0].code,
    /targets.sourceMark.apply\(ops.addStacks\(contexts.damage.select\(event => event.damageResult\).first\(\).map\(n => Math.floor\(n \* 0.5\)\)\)\)/,
  )
})
test('rejects unsupported definitions without silently changing actions', () => {
  for (const mutate of [
    d => (d.trigger = 'OnHit'),
    d => (d.apply = [d.apply]),
    d => (d.apply.extra = true),
    d => (d.apply.value.selector.chain[1].type = 'unknown'),
    d => (d.condition = null),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyMarkStackGains(d).reason)
  }
})
