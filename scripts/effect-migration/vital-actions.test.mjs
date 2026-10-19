import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyVitalAction, generateVitalActions } from './vital-actions.mjs'
const source = () => ({
  id: 'test',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: {
    type: 'heal',
    target: 'self',
    value: {
      type: 'dynamic',
      selector: {
        base: 'self',
        chain: [
          { type: 'select', arg: { type: 'base', arg: 'maxHp' } },
          { type: 'divide', arg: 8 },
        ],
      },
    },
  },
})
test('single actions retain their source path and reuse typed numeric operations', () => {
  const r = classifyVitalAction(source())
  assert.ok(!r.reason, r.reason)
  assert.equal(r.actions[0].sourcePath, '/apply')
  assert.match(r.actions[0].code, /ops.heal.*Math.floor\(n \/ 8\)/)
})
test('rejects lists and unsupported single definitions without dropping data', () => {
  for (const mutate of [
    d => (d.apply = [d.apply]),
    d => (d.apply.extra = true),
    d => (d.apply.value.selector.chain[1].arg = { type: 'raw:number', value: 8 }),
    d => (d.trigger = 'OnMarkDurationEnd'),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifyVitalAction(d).reason)
  }
})
test('preserves existing ownership while reproducing current single vital candidates', async () =>
  assert.deepEqual(await generateVitalActions({ check: true }), { generated: 38, rejected: 12, retained: 27 }))

test('retained entries preserve all existing provenance ledgers', async () => {
  const { readFile } = await import('node:fs/promises')
  const ledger = JSON.parse(await readFile('docs/v4/validation/vital-actions-candidates.json', 'utf8'))
  assert.deepEqual(ledger.retained.find(r => r.id === 'effect_skill_heal_self_90_hp').ownerLedgers, [
    'docs/v4/validation/instant-literals-candidates.json',
    'docs/v4/validation/official-healing-candidates.json',
  ])
})

test('dynamic multiplication preserves indexed factors and rejects unsupported factors', () => {
  const d = source()
  d.apply.value.selector.chain.push({
    type: 'multiply',
    arg: {
      type: 'dynamic',
      selector: { base: 'selfMarks', chain: [{ type: 'select', arg: { type: 'base', arg: 'stack' } }] },
    },
  })
  const recipe = classifyVitalAction(d)
  assert.ok(!recipe.reason, recipe.reason)
  assert.match(recipe.actions[0].code, /\.all\(\).*factors\[0\] \?\? 0/)
  d.apply.value.selector.chain[2].arg.selector.chain[0].arg.arg = 'unknown'
  assert.ok(classifyVitalAction(d).reason)
})

test('turn-order corrections accept only the exact named source nodes', () => {
  const d = source()
  d.id = 'effect_ability_add_rage_5_when_first_attack'
  d.condition = { type: 'every', conditions: [{ type: 'selfUseSkill' }, { type: 'isFirstSkillUsedThisTurn' }] }
  assert.deepEqual(classifyVitalAction(d).orderConditions, [
    { path: '/condition/conditions/1', condition: 'isFirstSkillUsedThisTurn' },
  ])
  for (const change of [
    x => x.condition.conditions.push({ type: 'isFirstSkillUsedThisTurn' }),
    x => x.condition.conditions.reverse(),
    x => (x.condition.conditions[1].type = 'isLastSkillUsedThisTurn'),
    x => (x.id = 'unmapped'),
    x => x.condition.conditions.pop(),
  ]) {
    const changed = structuredClone(d)
    change(changed)
    assert.ok(classifyVitalAction(changed).reason)
  }
})

test('conditional healing exposes separate branch parameters and rejects absent branches', () => {
  const d = source()
  d.apply.value = {
    type: 'conditional',
    condition: { type: 'selfUseSkill' },
    trueValue: { type: 'raw:number', value: 140 },
    falseValue: { type: 'raw:number', value: 0 },
  }
  const r = classifyVitalAction(d)
  assert.ok(!r.reason, r.reason)
  assert.deepEqual(r.parameters, [
    { name: 'action0_value_true', value: 140 },
    { name: 'action0_value_false', value: 0 },
  ])
  assert.match(r.actions[0].code, /values.choose.*parameters.action0_value_true,parameters.action0_value_false/)
  d.apply.value.falseValue = 0
  assert.ok(classifyVitalAction(d).reason)
  d.apply.value.falseValue = { type: 'raw:number', value: NaN }
  assert.ok(classifyVitalAction(d).reason)
})

test('conditional checkSelf shares the outer direct-event ownership mapping', () => {
  for (const trigger of ['OnHit', 'OnDamage', 'PostDamage']) {
    const d = source()
    d.trigger = trigger
    d.apply.value = { type: 'conditional', condition: { type: 'checkSelf' }, trueValue: 10, falseValue: 20 }
    const r = classifyVitalAction(d)
    assert.ok(!r.reason, r.reason)
    assert.match(r.actions[0].code, /values.choose\(conditions.sourceOwnsEvent,10,20\)/)
    assert.doesNotMatch(r.actions[0].code, /ownerUsesSkill/)
  }
})

test('stat-path corrections and paired hit triggers remain exact', () => {
  for (const [id, stat, trigger] of [
    ['effect_skill_deal_damage_spa_sixth_on_miss', 'spa', 'OnMiss'],
    ['effect_skill_heal_self_def_quarter_hit_or_miss', 'def', ['OnHit', 'OnMiss']],
  ]) {
    const d = source()
    d.id = id
    d.trigger = trigger
    d.apply.value.selector.chain[0].arg = { type: 'dynamic', arg: stat }
    const r = classifyVitalAction(d)
    assert.ok(!r.reason, r.reason)
    assert.deepEqual(r.pathRepairs, [
      { path: '/apply/value/selector/chain/0/arg/arg', before: stat, after: `stat.${stat}` },
    ])
    for (const mutate of [
      x => (x.apply.value.selector.chain[0].arg.type = 'base'),
      x => (x.apply.value.selector.chain[0].type = 'where'),
      x => (x.apply.value.selector.chain[0].arg.arg = 'spe'),
      x => (x.trigger = ['OnHit', 'OnDamage']),
      x => (x.trigger = []),
    ]) {
      const changed = structuredClone(d)
      mutate(changed)
      assert.ok(classifyVitalAction(changed).reason)
    }
  }
})
