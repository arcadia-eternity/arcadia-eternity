import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyVitalSequence, generateVitalSequences } from './vital-sequences.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: [
    { type: 'heal', target: 'self', value: 3 },
    { type: 'destroyMark', target: 'mark' },
  ],
})
test('vital sequences preserve full ordered actions', () =>
  assert.deepEqual(classifyVitalSequence(source()).actions, [
    { sourcePath: '/apply/0', code: 'targets.ownerPet.apply(ops.heal(3))' },
    { sourcePath: '/apply/1', code: 'targets.sourceMark.apply(ops.removeMark())' },
  ]))
test('rejects unsupported whole lists rather than dropping fields', () => {
  for (const mutate of [
    d => {
      d.apply[0].value = Infinity
    },
    d => {
      d.apply[0].target = 'selfPlayer'
    },
    d => {
      d.apply.push({ type: 'unknown' })
    },
    d => {
      d.trigger = 'OnStackBefore'
    },
    d => {
      d.apply[0].extra = 1
    },
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyVitalSequence(d).reason)
  }
})
test('keeps raw numeric parameters as editable authored parameters', () => {
  const d = source()
  d.apply[0].value = { type: 'raw:number', value: 3, configId: 'amount', tags: ['heal'] }
  const r = classifyVitalSequence(d)
  assert.deepEqual(r.parameters, [{ name: 'action0_value', value: 3, configId: 'amount', tags: ['heal'] }])
  assert.match(r.actions[0].code, /parameters.action0_value/)
})
test('reproduces nineteen vital candidates and no unsupported lists', async () =>
  assert.deepEqual(await generateVitalSequences({ check: true }), { generated: 19, rejected: 0 }))

test('turn-end and damage queries retain their distinct admission and value sources', () => {
  const d = source()
  d.trigger = 'TurnEnd'
  d.condition = { type: 'petIsActive' }
  assert.equal(classifyVitalSequence(d).when, 'conditions.ownerIsActive')
  d.trigger = 'OnDamage'
  d.condition = { type: 'selfBeDamaged' }
  d.apply = [
    {
      type: 'dealDamage',
      target: 'opponent',
      value: {
        type: 'dynamic',
        selector: {
          base: 'damageContext',
          chain: [
            { type: 'selectPath', arg: 'damageResult' },
            { type: 'divide', arg: 4 },
          ],
        },
      },
    },
  ]
  const r = classifyVitalSequence(d)
  assert.equal(r.when, 'conditions.selfBeDamaged')
  assert.match(r.actions[0].code, /contexts.damage.select.*damageResult.*Math.floor/)
})

test('damage modification before rage consumption retains separate queries and parameter identity', () => {
  const d = source()
  d.trigger = 'OnBeforeCalculateDamage'
  d.apply = [
    {
      type: 'addModified',
      target: { base: 'damageContext' },
      percent: 0,
      delta: { type: 'raw:number', value: 1, configId: 'factor' },
    },
    { type: 'addRage', target: 'selfPlayer', value: -5 },
  ]
  const r = classifyVitalSequence(d)
  assert.ok(!r.reason, r.reason)
  assert.match(r.actions[0].code, /contexts.damage.apply\(ops.modifyDamage/)
  assert.equal(r.actions[1].code, 'targets.selfPlayer.apply(ops.addRage(-5))')
  assert.deepEqual(r.parameters, [{ name: 'action0_value_delta', value: 1, configId: 'factor' }])
  d.apply[0].target = 'healContext'
  assert.ok(classifyVitalSequence(d).reason)
})

test('rejects conditional damage inputs without guessing condition ownership', () => {
  for (const field of ['percent', 'delta']) {
    const d = source()
    d.trigger = 'OnBeforeCalculateDamage'
    d.apply = [
      {
        type: 'addModified',
        target: 'damageContext',
        percent: 0,
        delta: 10,
        [field]: { type: 'conditional', condition: { type: 'checkSelf' }, trueValue: 10, falseValue: 20 },
      },
      { type: 'addRage', target: 'selfPlayer', value: -5 },
    ]
    assert.ok(classifyVitalSequence(d).reason)
  }
})

test('conditional divisors only admit finite nonzero branches and opponent mark existence', () => {
  const d = source()
  d.trigger = 'OnDamage'
  const divisor = {
    type: 'conditional',
    trueValue: 2,
    falseValue: 4,
    condition: { type: 'evaluate', target: { base: 'opponentMarks', chain: [] }, evaluator: { type: 'exist' } },
  }
  d.apply = [
    { type: 'preventDamage', target: 'damageContext' },
    {
      type: 'heal',
      target: 'self',
      value: {
        type: 'dynamic',
        selector: {
          base: 'damageContext',
          chain: [
            { type: 'selectPath', arg: 'damageResult' },
            { type: 'divide', arg: divisor },
          ],
        },
      },
    },
  ]
  const r = classifyVitalSequence(d)
  assert.ok(!r.reason, r.reason)
  assert.match(r.actions[0].code, /ops.preventDamage/)
  assert.match(r.actions[1].code, /values.combine.*values.choose.*Math.floor/)
  for (const value of [0, Infinity, { type: 'raw:number', value: 2 }]) {
    divisor.trueValue = value
    assert.ok(classifyVitalSequence(d).reason)
  }
  divisor.trueValue = 2
  divisor.condition = { type: 'checkSelf' }
  assert.ok(classifyVitalSequence(d).reason)
})

test('stack sequences retain event values and separate configurable consumption', () => {
  const d = source()
  d.trigger = 'OnStack'
  d.condition = {
    type: 'every',
    conditions: [
      { type: 'checkSelf' },
      {
        type: 'evaluate',
        target: { base: 'stackContext', chain: [{ type: 'selectPath', arg: 'stacksAfter' }] },
        evaluator: { type: 'compare', operator: '>=', value: 100 },
      },
    ],
  }
  d.apply = [
    { type: 'dealDamage', target: 'self', value: { type: 'raw:number', value: 100, configId: 'damage' } },
    { type: 'consumeStacks', target: 'mark', value: { type: 'raw:number', value: 100, configId: 'consume' } },
  ]
  const r = classifyVitalSequence(d)
  assert.ok(!r.reason, r.reason)
  assert.match(r.when, /sourceOwnsEvent.*contexts.stack.select/)
  assert.match(r.actions[1].code, /targets.sourceMark.apply\(ops.consumeStacks\(parameters.action1_value/)
  assert.equal(r.parameters.length, 2)
  d.condition.conditions[1].target.chain[0].arg = 'unknown'
  assert.ok(classifyVitalSequence(d).reason)
})

test('self damage source corrections require the exact named source nodes', () => {
  for (const id of [
    'effect_mark_self_damage_50_percent_once',
    'effect_mark_self_damage_50_percent_once_when_special',
  ]) {
    const d = source()
    d.id = id
    d.trigger = 'OnDamage'
    d.condition = {
      type: 'every',
      conditions: [
        { type: 'selfUseSkill' },
        { type: 'selfUseSkill' },
        {
          type: 'evaluate',
          target: { base: 'damageContext', chain: [{ type: 'selectPath', arg: 'sourceId' }] },
          evaluator: { type: 'notSame', value: { type: 'dynamic', selector: 'mark' } },
        },
      ],
    }
    const r = classifyVitalSequence(d)
    assert.ok(!r.reason, r.reason)
    assert.deepEqual(r.pathRepairs, [
      { path: '/condition/conditions/2/target/chain/0/arg', before: 'sourceId', after: 'source' },
    ])
    assert.match(r.when, /event.source.*!==.*targets.sourceMark/)
    d.condition.conditions[2].target.chain[0].arg = 'unexpected'
    assert.match(classifyVitalSequence(d).reason, /C09 source node changed/)
    d.id = 'unknown-source-id'
    d.condition.conditions[2].target.chain[0].arg = 'sourceId'
    assert.ok(classifyVitalSequence(d).reason)
  }
})
