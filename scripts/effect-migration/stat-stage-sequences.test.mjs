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
test('reproduces all twelve stat-stage lists with an explicit C10 correction', async () =>
  assert.deepEqual(await generateStatStageSequences({ check: true }), { generated: 12, rejected: 0 }))

test('C10 is a named-node correction and never a global selectorValue alias', () => {
  const d = source()
  d.id = 'effect_skill_raise_atk_1_stage_and_other_1_stage'
  d.apply[1].statType = {
    type: 'selectorValue',
    value: ['def', 'spd', 'spa', 'spe'],
    chain: [{ type: 'randomPick', arg: 1 }],
  }
  const before = structuredClone(d),
    r = classifyStatStageSequence(d)
  assert.deepEqual(d, before)
  assert.deepEqual(r.valueRepairs, [{ path: '/apply/1/statType/type', before: 'selectorValue', after: 'selector' }])
  assert.match(r.actions[1].code, /targets.opponentActive.apply/)
  assert.match(r.actions[1].code, /shuffled\(\).first\(\)/)
  d.id = 'unknown'
  assert.ok(classifyStatStageSequence(d).reason)
  d.id = before.id
  d.apply[1].statType.type = 'selector'
  assert.match(classifyStatStageSequence(d).reason, /C10 source node changed/)
})
test('random stat recognition rejects unsupported counts, members and metadata', () => {
  for (const mutate of [
    p => {
      p.chain[0].arg = 2
    },
    p => {
      p.value = []
    },
    p => {
      p.value = ['hp']
    },
    p => {
      p.extra = true
    },
    p => {
      p.chain.push({ type: 'randomPick', arg: 1 })
    },
  ]) {
    const d = source()
    d.apply[1].statType = {
      type: 'selector',
      value: ['def', 'spd', 'spa', 'spe'],
      chain: [{ type: 'randomPick', arg: 1 }],
    }
    mutate(d.apply[1].statType)
    assert.ok(classifyStatStageSequence(d).reason)
  }
})
