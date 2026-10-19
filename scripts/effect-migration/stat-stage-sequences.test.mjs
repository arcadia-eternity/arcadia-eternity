import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStatStageSequence, generateStatStageSequences } from './stat-stage-sequences.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'BeforeHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: [
    { type: 'statStageBuff', target: 'self', statType: 'spd', value: 1 },
    { type: 'statStageBuff', target: { base: 'opponent' }, statType: 'spe', value: -1 },
  ],
})
test('preserves ordered stat operations and distinguishes special defense from speed', () => {
  const d = source(),
    before = structuredClone(d),
    r = classifyStatStageSequence(d)
  assert.deepEqual(d, before)
  assert.deepEqual(r.actions, [
    { sourcePath: '/apply/0', code: 'targets.ownerPet.apply(ops.changeStatStage("spd",1))' },
    { sourcePath: '/apply/1', code: 'targets.opponentActive.apply(ops.changeStatStage("spe",-1))' },
  ])
})
test('rejects whole lists with unsupported stat values, actions, metadata or conditions', () => {
  for (const mutate of [
    d => {
      d.apply[0].statType = 'hp'
    },
    d => {
      d.apply[0].value = { type: 'raw:number', value: 1 }
    },
    d => {
      d.apply[0].strategy = 'set'
    },
    d => {
      d.apply.push({ type: 'unknown' })
    },
    d => {
      d.trigger = 'TurnEnd'
    },
    d => {
      d.condition = { type: 'unknown' }
    },
    d => {
      d.apply[0].statType = { type: 'selectorValue', value: ['atk'], chain: [] }
    },
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyStatStageSequence(d).reason)
  }
})
test('reproduces eleven fixed stat-stage lists and explicitly rejects the random-stat list', async () =>
  assert.deepEqual(await generateStatStageSequences({ check: true }), { generated: 11, rejected: 1 }))
