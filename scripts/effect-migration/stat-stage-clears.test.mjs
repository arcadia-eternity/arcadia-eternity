import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStatStageClears, generateStatStageClears } from './stat-stage-clears.mjs'
const source = () => ({
  id: 'test',
  trigger: 'BeforeHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'clearStatStage', target: 'opponent' },
})
test('reproduces ten stage-clearing candidates', async () =>
  assert.deepEqual(await generateStatStageClears({ check: true }), { generated: 10, rejected: 0 }))
test('preserves positive default, empty-as-all, order and spd/spe identity', () => {
  const d = source()
  assert.match(classifyStatStageClears(d).actions[0].code, /stats:\[\],strategy:"positive"/)
  d.apply.statType = ['spe', 'spd', 'spe']
  d.apply.cleanStageStrategy = 'all'
  assert.match(classifyStatStageClears(d).actions[0].code, /stats:\["spe","spd","spe"\],strategy:"all"/)
  d.apply.statType = 'spd'
  assert.match(classifyStatStageClears(d).actions[0].code, /stats:\["spd"\]/)
})
test('rejects malformed stats, unsupported selectors and trigger combinations', () => {
  for (const mutate of [
    d => (d.apply.statType = 'hp'),
    d => (d.apply.statType = null),
    d => (d.apply.statType = { type: 'dynamic', selector: 'self' }),
    d => (d.apply.cleanStageStrategy = null),
    d => (d.apply.cleanStageStrategy = 'unknown'),
    d => (d.apply.extra = true),
    d => (d.trigger = ['BeforeHit', 'OnHit']),
    d => (d.apply = [d.apply]),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyStatStageClears(d).reason)
  }
})
