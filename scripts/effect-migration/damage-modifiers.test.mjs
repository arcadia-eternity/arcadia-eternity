import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDamageModifier, generateDamageModifiers } from './damage-modifiers.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnBeforeCalculateDamage',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addModified', target: 'damageContext', percent: 20, delta: 0 },
})
test('emits typed queries, separate arithmetic floors and lazy conditionals', () => {
  const d = source()
  d.apply.delta = {
    type: 'dynamic',
    selector: {
      base: 'opponent',
      chain: [
        { type: 'select', arg: { type: 'base', arg: 'maxHp' } },
        { type: 'divide', arg: 4 },
        { type: 'multiply', arg: 0.5 },
        { type: 'clampMax', arg: 180 },
      ],
    },
  }
  d.apply.percent = {
    type: 'conditional',
    condition: { type: 'selfHasMark', baseId: 'mark_a' },
    trueValue: 30,
    falseValue: 10,
  }
  const r = classifyDamageModifier(d)
  assert.match(r.delta, /Math.floor\(n \/ 4\).*Math.floor\(n \* 0.5\).*Math.min\(n, 180\)/)
  assert.match(r.percent, /values.choose/)
  assert.match(r.percent, /mark.baseId === "mark_a"/)
})
test('preserves ordered admission and late damage stage rather than rewriting it', () => {
  const d = source()
  d.trigger = 'OnDamage'
  d.condition = {
    type: 'every',
    conditions: [{ type: 'checkSelf' }, { type: 'not', condition: { type: 'selfHasMark', baseId: 'mark_b' } }],
  }
  const r = classifyDamageModifier(d)
  assert.deepEqual(r.triggers, ['OnDamage'])
  assert.match(r.when, /conditions.all\(conditions.selfBeDamaged,conditions.not/)
})
test('rejects unhandled fields, invalid parameters, target chains, nonfinite numbers and unsupported stages', () => {
  const d = source()
  for (const bad of [
    { ...d, consumesStacks: -1 },
    { ...d, priority: NaN },
    { ...d, trigger: [] },
    { ...d, trigger: ['OnDamage', 'OnDamage'] },
    { ...d, trigger: 'BeforeRageGain' },
    { ...d, apply: { ...d.apply, delta: Infinity } },
    { ...d, apply: { ...d.apply, delta: { type: 'raw:number', value: 2, unknown: true } } },
    { ...d, apply: { ...d.apply, target: { base: 'damageContext', chain: [] } } },
    { ...d, condition: { type: 'selfUseSkill', extra: true } },
    {
      ...d,
      apply: {
        ...d.apply,
        delta: { type: 'dynamic', selector: { base: 'mark', chain: [{ type: 'selectAttribute$', arg: 'stack' }] } },
      },
    },
    {
      ...d,
      apply: {
        ...d.apply,
        delta: {
          type: 'dynamic',
          selector: { base: 'self', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'weight' } }] },
        },
      },
    },
  ])
    assert.ok(classifyDamageModifier(bad).reason, JSON.stringify(bad))
})
test('source and per-ID ledger reproduce, retaining the handwritten HP effect', async () => {
  assert.deepEqual(await generateDamageModifiers({ check: true }), { generated: 103, protected: 1, rejected: 13 })
})

test('rejects false-zero branch absence and multi-member compare instead of changing legacy meaning', () => {
  const d = source()
  const missing = {
    type: 'conditional',
    condition: { type: 'selfHasMark', baseId: 'mark_missing' },
    trueValue: 20,
    falseValue: 0,
  }
  assert.ok(classifyDamageModifier({ ...d, apply: { ...d.apply, percent: missing, delta: 5 } }).reason)
  assert.ok(
    classifyDamageModifier({ ...d, apply: { ...d.apply, percent: { ...missing, falseValue: missing } } }).reason,
  )
  assert.ok(
    classifyDamageModifier({
      ...d,
      condition: {
        type: 'evaluate',
        target: { base: 'selfMarks', chain: [{ type: 'select', arg: { type: 'base', arg: 'stack' } }] },
        evaluator: { type: 'compare', operator: '>', value: 2 },
      },
    }).reason,
  )
})

test('preserves raw parameters, stable names, aliases and separate negative multiplication floors', () => {
  const d = source()
  d.apply.percent = {
    type: 'dynamic',
    selector: {
      base: 'mark',
      chain: [
        { type: 'select', arg: { type: 'base', arg: 'stack' } },
        { type: 'multiply', arg: { type: 'raw:number', value: 15, configId: 'per_stack', tags: ['damage'] } },
        { type: 'multiply', arg: -1 },
      ],
    },
  }
  const r = classifyDamageModifier(d)
  assert.deepEqual(r.parameters, [{ name: 'percent_step1', value: 15, configId: 'per_stack', tags: ['damage'] }])
  assert.match(r.percent, /values.combine.*Math.floor\(n \* factor\).*map\(n => Math.floor\(n \* -1\)\)/)
  for (const bad of [
    { type: 'raw:number', value: Infinity },
    { type: 'raw:number', value: 2, configId: '' },
    { type: 'raw:number', value: 2, tags: [2] },
    { type: 'raw:number', value: 2, extra: true },
  ])
    assert.ok(classifyDamageModifier({ ...source(), apply: { ...source().apply, delta: bad } }).reason)
  const duplicate = { type: 'raw:number', value: 2, configId: 'shared' }
  assert.ok(
    classifyDamageModifier({ ...source(), apply: { ...source().apply, percent: duplicate, delta: duplicate } }).reason,
  )
})

test('rejects configured divisors and unmapped nested parameter branches', () => {
  const d = source()
  d.apply.delta = {
    type: 'dynamic',
    selector: {
      base: 'opponent',
      chain: [
        { type: 'select', arg: { type: 'base', arg: 'maxHp' } },
        { type: 'divide', arg: { type: 'raw:number', value: 2 } },
      ],
    },
  }
  assert.ok(classifyDamageModifier(d).reason)
  d.apply.delta = {
    type: 'conditional',
    condition: { type: 'selfUseSkill' },
    trueValue: { type: 'raw:number', value: 2 },
    falseValue: 3,
  }
  assert.ok(classifyDamageModifier(d).reason)
})

test('retains automatic consumption and effect tags while rejecting malformed metadata', () => {
  for (const input of [null, undefined, [], 'effect']) assert.ok(classifyDamageModifier(input).reason)
  const r = classifyDamageModifier({ ...source(), consumesStacks: 1, tags: ['xingzhili'] })
  assert.equal(r.consumesStacks, 1)
  assert.deepEqual(r.tags, ['xingzhili'])
  assert.equal(classifyDamageModifier({ ...source(), consumesStacks: 0 }).consumesStacks, 0)
  for (const consumesStacks of [-1, 0.5, Infinity, '1'])
    assert.ok(classifyDamageModifier({ ...source(), consumesStacks }).reason)
  for (const tags of [null, 'tag', [2]]) assert.ok(classifyDamageModifier({ ...source(), tags }).reason)
  assert.ok(classifyDamageModifier({ ...source(), extra: true }).reason)
})

test('C07 shares nearest-skill scalar queries with damage admission without changing checkSelf', () => {
  for (const [field, evaluator] of [
    ['element', { type: 'same', value: 'Ice' }],
    ['category', { type: 'same', value: 'Physical' }],
    ['multihitResult', { type: 'compare', operator: '>', value: 1 }],
  ]) {
    const d = source()
    d.condition = {
      type: 'every',
      conditions: [
        { type: 'checkSelf' },
        {
          type: 'evaluate',
          target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: field }] },
          evaluator,
        },
      ],
    }
    const before = structuredClone(d)
    const r = classifyDamageModifier(d)
    assert.match(r.when, /conditions.all\(conditions.selfBeDamaged,/)
    assert.match(r.when, /contexts.skillUse/)
    assert.deepEqual(r.selectorRepairs, ['/condition/conditions/1/target/base'])
    assert.deepEqual(r.additionalDecisions, ['C07'])
    assert.deepEqual(d, before)
    d.condition.conditions[1].target.chain[0].arg = 'currentHitCount'
    assert.ok(classifyDamageModifier(d).reason)
  }
})

test('damage order mappings require the exact recorded ID, path and predicate', () => {
  const d = source()
  d.id = 'effect_skill_add_fixed_damage_50_if_first'
  d.condition = { type: 'every', conditions: [{ type: 'selfUseSkill' }, { type: 'isFirstSkillUsedThisTurn' }] }
  const r = classifyDamageModifier(d)
  assert.match(r.when, /conditions.firstSkillThisTurn/)
  assert.deepEqual(r.additionalDecisions, ['C08'])
  assert.deepEqual(r.orderConditions, [{ path: '/condition/conditions/1', condition: 'isFirstSkillUsedThisTurn' }])
  assert.ok(classifyDamageModifier({ ...d, id: 'unrecorded' }).reason)
  d.condition.conditions.reverse()
  assert.ok(classifyDamageModifier(d).reason)
  d.condition.conditions.reverse()
  d.condition.conditions[1].type = 'isLastSkillUsedThisTurn'
  assert.ok(classifyDamageModifier(d).reason)
})

test('skill identity damage corrections reject source drift and retain both repair decisions', () => {
  const d = source()
  d.id = 'effect_emblem_zhongji_damage_boost_35_percent'
  d.condition = {
    type: 'every',
    conditions: [
      { type: 'checkSelf' },
      {
        type: 'evaluate',
        target: {
          base: 'useSkillContext',
          chain: [
            { type: 'selectPath', arg: 'skillId' },
            { type: 'select', arg: { type: 'base', arg: 'baseId' } },
          ],
        },
        evaluator: { type: 'same', value: 'skill_zhongji' },
      },
    ],
  }
  const r = classifyDamageModifier(d)
  assert.deepEqual(r.additionalDecisions, ['C07', 'C09'])
  assert.match(r.when, /skill.baseId === "skill_zhongji"/)
  assert.deepEqual(r.pathRepairs, [
    { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
  ])
  d.condition.conditions[1].target.chain[0].arg = 'skill'
  assert.ok(classifyDamageModifier(d).reason)
})

test('damage Pet-stat mapping requires corrected paths and floors the sixth', () => {
  const d = source()
  d.id = 'effect_skill_add_damage_spa_sixth'
  d.apply.delta = {
    type: 'dynamic',
    selector: {
      base: 'self',
      chain: [
        { type: 'select', arg: { type: 'dynamic', arg: 'spa' } },
        { type: 'divide', arg: 6 },
      ],
    },
  }
  const r = classifyDamageModifier(d)
  assert.match(r.delta, /pet.stat.spa.*Math.floor\(n \/ 6\)/)
  assert.deepEqual(r.pathRepairs, [{ path: '/apply/delta/selector/chain/0/arg/arg', before: 'spa', after: 'stat.spa' }])
  d.apply.delta.selector.chain[0].arg.arg = 'stat.spa'
  assert.ok(classifyDamageModifier(d).reason)
})

test('damage conditions support opponent skill actors and exact dynamic own-element equality', () => {
  const d = source()
  d.condition = {
    type: 'every',
    conditions: [{ type: 'opponentUseSkill' }, { type: 'opponentHasMark', baseId: 'mark_cuimian' }],
  }
  assert.match(classifyDamageModifier(d).when, /skillActorDiffersFromOwner/)
  d.condition = {
    type: 'evaluate',
    target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: 'element' }] },
    evaluator: {
      type: 'same',
      value: { type: 'dynamic', selector: { base: 'self', chain: [{ type: 'selectPath', arg: 'element' }] } },
    },
  }
  assert.match(classifyDamageModifier(d).when, /event.element.*pet.element/)
  d.condition.evaluator.value.selector.chain[0].arg = 'category'
  assert.ok(classifyDamageModifier(d).reason)
})

test('inclusive random damage requires the two exact C14 source definitions', () => {
  const d = source()
  d.id = 'effect_skill_fixed_damage_30_70'
  d.apply.delta = { type: 'selectorValue', value: [30, 70], chain: [{ type: 'sampleBetween' }] }
  const r = classifyDamageModifier(d)
  assert.equal(r.delta, 'values.randomInt(30,70)')
  assert.deepEqual(r.rangeDecision, { decision: 'C14', path: '/apply/delta', min: 30, max: 70 })
  assert.deepEqual(r.additionalDecisions, ['C14'])
  assert.ok(classifyDamageModifier({ ...d, id: 'unknown' }).reason)
  d.apply.delta.value = [30, 71]
  assert.ok(classifyDamageModifier(d).reason)
})
