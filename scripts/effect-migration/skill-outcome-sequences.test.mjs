import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySkillOutcomeSequence, generateSkillOutcomeSequences } from './skill-outcome-sequences.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'AfterUseSkillCheck',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: [
    { type: 'setSureHit', target: 'useSkillContext', priority: 2 },
    { type: 'consumeStacks', target: { base: 'selfMarks', chain: [] }, value: 1 },
  ],
})
test('preserves each action and source path in order', () => {
  const d = source(),
    before = structuredClone(d),
    r = classifySkillOutcomeSequence(d)
  assert.deepEqual(d, before)
  assert.deepEqual(r.repairedPaths, ['/apply/0/target'])
  assert.deepEqual(r.actions, [
    { sourcePath: '/apply/0', code: 'contexts.skillUse.apply(ops.setSureHit(2))' },
    { sourcePath: '/apply/1', code: 'targets.ownerMarks.apply(ops.consumeStacks(1))' },
  ])
  d.apply.reverse()
  assert.match(classifySkillOutcomeSequence(d).actions[0].code, /consumeStacks/)
})
test('rejects the whole definition when any action or metadata is unsupported', () => {
  for (const mutate of [
    d => {
      d.apply.push({ type: 'unmapped' })
    },
    d => {
      d.apply = []
    },
    d => {
      d.apply[1].value = Infinity
    },
    d => {
      d.apply[1].target = 'opponent'
    },
    d => {
      d.tags = [1]
    },
    d => {
      d.consumesStacks = -1
    },
    d => {
      d.trigger = 'OnDamage'
    },
    d => {
      d.condition = { type: 'isFirstSkillUsedThisTurn' }
    },
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifySkillOutcomeSequence(d).reason)
  }
})
test('reproduces all eight current outcome action lists', async () =>
  assert.deepEqual(await generateSkillOutcomeSequences({ check: true }), { generated: 8, rejected: 0 }))

test('does not inherit conditional power ownership or hidden turn-order corrections', () => {
  for (const type of ['checkSelf', 'isFirstSkillUsedThisTurn']) {
    const d = source()
    d.apply.push({
      type: 'addPower',
      target: 'useSkillContext',
      value: { type: 'conditional', condition: { type }, trueValue: 1, falseValue: 2 },
    })
    assert.ok(classifySkillOutcomeSequence(d).reason)
  }
})

test('the named C09 node reads skill category independently of use-context category', () => {
  const d = source()
  d.id = 'effect_mark_next_non_status_skill_sure_crit'
  d.condition = {
    type: 'every',
    conditions: [
      { type: 'checkSelf' },
      { type: 'selfUseSkill' },
      {
        type: 'evaluate',
        target: {
          base: 'useSkillContext',
          chain: [
            { type: 'selectPath', arg: 'skillId' },
            { type: 'selectPath', arg: 'category' },
          ],
        },
        evaluator: { type: 'notSame', value: 'Status' },
      },
    ],
  }
  const r = classifySkillOutcomeSequence(d)
  assert.match(r.when, /events\[0\]\?\.skill.category/)
  assert.deepEqual(r.pathRepairs, [
    { path: '/condition/conditions/2/target/chain/0/arg', before: 'skillId', after: 'skill' },
  ])
  d.condition.conditions[2].target.chain[0].arg = 'unknown'
  assert.match(classifySkillOutcomeSequence(d).reason, /C09 source node changed/)
})
