import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStatStage, generateStatStages } from './stat-stages.mjs'
const source = () => ({
  id: 'example',
  trigger: 'BeforeHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'statStageBuff', target: { base: 'opponent' }, statType: 'def', value: -1 },
})
const roll = {
  type: 'evaluate',
  target: 'self',
  evaluator: {
    type: 'probability',
    percent: { type: 'raw:number', value: 20, configId: 'chance', tags: ['skill_effect_probability'] },
  },
}
test('preserves ordered nested admission, stable paths and raw parameter metadata', () => {
  const d = source()
  const r = classifyStatStage({
    ...d,
    condition: { type: 'every', conditions: [d.condition, { type: 'every', conditions: [roll, d.condition] }] },
  })
  assert.deepEqual(
    r.clauses.map(c => [c.kind, c.path]),
    [
      ['self', 'condition/0'],
      ['probability', 'condition/1/0'],
      ['self', 'condition/1/1'],
    ],
  )
  assert.equal(r.clauses[1].alias, 'chance')
  assert.deepEqual(r.clauses[1].tags, ['skill_effect_probability'])
  assert.equal(r.value, -1)
})
test('rejects unsupported semantics and ambiguous parameter aliases', () => {
  const d = source()
  for (const bad of [
    { ...d, consumesStacks: 1 },
    { ...d, priority: NaN },
    { ...d, trigger: 'OnDamage' },
    { ...d, trigger: [] },
    { ...d, trigger: ['BeforeHit', 'BeforeHit'] },
    { ...d, condition: { type: 'every', conditions: [] } },
    { ...d, condition: { type: 'every', conditions: [d.condition, roll, roll] } },
    { ...d, apply: { ...d.apply, value: { type: 'raw:number', value: 1 } } },
    { ...d, apply: { ...d.apply, target: { base: 'opponent', chain: [] } } },
    { ...d, apply: { ...d.apply, statType: 'hp' } },
    { ...d, apply: { ...d.apply, value: Infinity } },
    { ...d, condition: { type: 'every', conditions: [d.condition, { ...roll, unexpected: true }] } },
  ])
    assert.ok(classifyStatStage(bad).reason)
})
test('all emitted source and ledger reproduce exactly', async () =>
  assert.deepEqual(await generateStatStages({ check: true }), { generated: 100, parameters: 42, rejected: 2 }))

test('shared authored conditions preserve stat identity and ordered admission', () => {
  const d = source()
  const input = {
    ...d,
    apply: { ...d.apply, statType: 'spd' },
    condition: {
      type: 'every',
      conditions: [
        d.condition,
        { type: 'selfHasMark', baseId: 'mark_example' },
        { type: 'continuousUseSkill', times: 2, strategy: 'Periodic' },
      ],
    },
  }
  const before = structuredClone(input)
  const r = classifyStatStage(input)
  assert.equal(r.stat, 'spd')
  assert.match(r.when, /^conditions.all\(conditions.selfUsesSkill,targets.ownerMarks/)
  assert.match(r.when, /conditions.everyNthUse\(2\)/)
  assert.deepEqual(input, before)
  assert.equal(
    classifyStatStage({ ...d, condition: { type: 'selfBeSkillTarget' } }).when,
    'conditions.ownerIsSkillTarget',
  )
})
test('shared authored conditions reject unmapped turn order and new parameters', () => {
  const d = source()
  for (const extra of [
    { type: 'isLastSkillUsedThisTurn' },
    { type: 'not', condition: { type: 'isFirstSkillUsedThisTurn' } },
    { type: 'every', conditions: [{ type: 'selfHasMark', baseId: 'mark_example' }, roll] },
  ])
    assert.ok(classifyStatStage({ ...d, condition: { type: 'every', conditions: [d.condition, extra] } }).reason)
})

test('additional skill stages record C07 without mutating the source', () => {
  const d = {
    ...source(),
    trigger: 'BeforeMultiHit',
    condition: {
      type: 'every',
      conditions: [
        source().condition,
        {
          type: 'evaluate',
          target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: 'multihitResult' }] },
          evaluator: { type: 'compare', operator: '==', value: 3 },
        },
      ],
    },
  }
  const before = structuredClone(d),
    r = classifyStatStage(d)
  assert.deepEqual(d, before)
  assert.deepEqual(r.selectorRepairs, ['/condition/conditions/1/target/base'])
  assert.deepEqual(r.additionalDecisions, ['C07'])
  assert.match(r.when, /contexts.skillUse/)
  for (const trigger of ['OnCritPreDamage', 'OnDefeat'])
    assert.equal(classifyStatStage({ ...source(), trigger }).when, 'conditions.selfUsesSkill')
})

test('C09 skill path fixes are restricted to exact stat-stage source nodes', () => {
  for (const id of [
    'effect_emblem_raise_spd_1_stage_when_baonuan_20_percent',
    'effect_emblem_raise_spd_1_stage_when_rouruan_20_percent',
  ]) {
    const d = {
      ...source(),
      id,
      condition: {
        type: 'every',
        conditions: [
          source().condition,
          {
            type: 'evaluate',
            target: {
              base: 'useSkillContext',
              chain: [
                { type: 'selectPath', arg: 'skillId' },
                { type: 'select', arg: { type: 'base', arg: 'baseId' } },
              ],
            },
            evaluator: { type: 'same', value: 'skill_baonuan' },
          },
        ],
      },
    }
    const before = structuredClone(d),
      r = classifyStatStage(d)
    assert.deepEqual(d, before)
    assert.deepEqual(r.additionalDecisions, ['C07', 'C09'])
    assert.deepEqual(r.pathRepairs, [
      { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
    ])
    assert.ok(classifyStatStage({ ...d, id: 'unreviewed' }).reason)
    d.condition.conditions[1].target.chain[0].arg = 'unknown'
    assert.match(classifyStatStage(d).reason, /C09 source node changed/)
  }
})
test('C08 last-skill admission is explicit and rejects moved correction nodes', () => {
  const d = {
    ...source(),
    id: 'effect_skill_reduce_opponent_spa_1_stage_if_opponent_has_kaowen_and_last',
    condition: {
      type: 'every',
      conditions: [
        source().condition,
        { type: 'opponentHasMark', baseId: 'mark_kaowen' },
        { type: 'isLastSkillUsedThisTurn' },
      ],
    },
  }
  assert.deepEqual(classifyStatStage(d).additionalDecisions, ['C08'])
  assert.match(classifyStatStage(d).when, /conditions.lastSkillThisTurn/)
  for (const extra of [
    { type: 'isFirstSkillUsedThisTurn' },
    { type: 'isLastSkillUsedThisTurn' },
    { type: 'not', condition: { type: 'isFirstSkillUsedThisTurn' } },
    {
      type: 'evaluate',
      target: 'self',
      evaluator: {
        type: 'compare',
        operator: '==',
        value: {
          type: 'conditional',
          condition: { type: 'isFirstSkillUsedThisTurn' },
          trueValue: 1,
          falseValue: 0,
        },
      },
    },
  ]) {
    const duplicate = structuredClone(d)
    duplicate.condition.conditions.push(extra)
    assert.match(classifyStatStage(duplicate).reason, /turn-order correction/)
  }
  d.condition.conditions.reverse()
  assert.ok(classifyStatStage(d).reason)
})

test('damage-stage probability uses shared skill admission and authored parameter metadata', () => {
  const d = {
    ...source(),
    id: 'effect_skill_reduce_stat_5_percent',
    trigger: 'OnDamage',
    condition: { type: 'every', conditions: [source().condition, roll] },
  }
  const before = structuredClone(d)
  const r = classifyStatStage(d)
  assert.deepEqual(d, before)
  assert.match(r.when, /conditions.selfUsesSkill/)
  assert.match(r.when, /conditions.chance\(parameters.condition_1_percent\)/)
  assert.deepEqual(r.parameters, [
    { name: 'condition_1_percent', value: 20, tags: ['skill_effect_probability'], configId: 'chance' },
  ])
  assert.ok(classifyStatStage({ ...d, id: 'unreviewed' }).reason)
})

test('damage-stage domain cannot inherit skill-only checkSelf or mixed triggers', () => {
  const d = {
    ...source(),
    id: 'effect_skill_reduce_stat_5_percent',
    trigger: 'OnDamage',
    condition: { type: 'checkSelf' },
  }
  assert.equal(classifyStatStage(d).when, 'conditions.selfBeDamaged')
  assert.ok(classifyStatStage({ ...d, trigger: ['OnDamage', 'BeforeHit'] }).reason)
})
