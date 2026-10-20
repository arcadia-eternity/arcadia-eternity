import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMarkApplicationSettings, generateMarkApplicationSettings } from './mark-application-settings.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnBeforeAddMark',
  priority: 0,
  condition: { type: 'selfBeAddMark' },
  apply: {
    type: 'setMarkDuration',
    target: 'addMarkContext',
    value: {
      type: 'dynamic',
      selector: {
        base: 'addMarkContext',
        chain: [
          { type: 'select', arg: { type: 'dynamic', arg: 'duration' } },
          { type: 'add', arg: 1 },
        ],
      },
    },
  },
})
test('reproduces all 17 mark application setting candidates', async () =>
  assert.deepEqual(await generateMarkApplicationSettings({ check: true }), { generated: 17, rejected: 0 }))
test('emits deferred context reads and complete value lists', () => {
  const r = classifyMarkApplicationSettings(source())
  assert.equal(r.when, 'conditions.ownerReceivesMark')
  assert.match(r.actions[0].code, /contexts.addMark.select\(event => event.duration\).all\(\)/)
})
test('rejects unknown fields, wrong events and unreviewed mark paths', () => {
  for (const mutate of [
    d => (d.apply.extra = true),
    d => (d.apply.target = 'mark'),
    d => (d.trigger = 'OnMarkCreated'),
    d => (d.apply.value.selector.chain[0].arg.arg = 'foo'),
    d => (d.id = 'effect_emblem_set_zhongdu_duration_2'),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyMarkApplicationSettings(d).reason)
  }
})
