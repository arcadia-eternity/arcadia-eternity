import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyEventCancellation, generateEventCancellation } from './event-cancellation.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnBeforeAddMark',
  priority: 0,
  condition: { type: 'selfBeAddMark' },
  apply: { type: 'disableContext', target: 'addMarkContext' },
})
test('reproduces ten cancellations and retains two unsupported lifecycle triggers', async () =>
  assert.deepEqual(await generateEventCancellation({ check: true }), { generated: 10, rejected: 2 }))
test('cancellation uses a fresh context query', () => {
  assert.equal(classifyEventCancellation(source()).actions[0].code, 'contexts.addMark.apply(ops.disableContext())')
})
test('rejects unsupported contexts, triggers, extra fields and unreviewed aliases', () => {
  for (const mutate of [
    d => (d.apply.target = 'consumeStackContext'),
    d => (d.trigger = 'BeforeRageGain'),
    d => (d.apply.value = 1),
    ...['constructor', 'toString', '__proto__'].map(target => d => (d.apply.target = target)),
    d =>
      (d.condition = {
        type: 'evaluate',
        target: { base: 'addMarkContext', chain: [{ type: 'selectPath', arg: 'baseMarkId' }] },
        evaluator: { type: 'same', value: 'mark_haipa' },
      }),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyEventCancellation(d).reason)
  }
})
