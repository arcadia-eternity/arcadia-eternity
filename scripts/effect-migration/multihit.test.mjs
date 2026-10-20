import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMultihit, generateMultihit } from './multihit.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'BeforeMultiHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: {
    type: 'addMultihitResult',
    target: 'useSkillContext',
    value: {
      type: 'dynamic',
      selector: { base: 'opponentMarks', chain: [{ type: 'select', arg: { type: 'base', arg: 'stack' } }] },
    },
  },
})
test('reproduces all 18 multihit candidates', async () =>
  assert.deepEqual(await generateMultihit({ check: true }), { generated: 18, rejected: 0 }))
test('addition consumes every value while assignment consumes the first', () => {
  const d = source()
  assert.match(classifyMultihit(d).actions[0].code, /\.all\(\)/)
  d.apply.type = 'setMultihit'
  assert.match(classifyMultihit(d).actions[0].code, /\.first\(\)/)
})
test('rejects unknown targets, tuple literals and unreviewed order/path corrections', () => {
  for (const mutate of [
    d => (d.apply.target = 'self'),
    d => (d.apply.value = [2, 4]),
    d => (d.apply.extra = true),
    d => (d.condition = { type: 'isFirstSkillUsedThisTurn' }),
    d => (d.id = 'effect_mark_shuangrenzhan_add_2_hits'),
    d => (d.apply = [d.apply]),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyMultihit(d).reason)
  }
})
