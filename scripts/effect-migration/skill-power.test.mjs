import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySkillPower, generateSkillPower, repairSkillSelector, repairSkillPaths } from './skill-power.mjs'
const source = () => ({
  id: 'test',
  trigger: 'AfterUseSkillCheck',
  priority: 0,
  condition: { type: 'checkSelf' },
  apply: { type: 'addPower', target: 'useSkillContext', value: 20 },
})
test('records spelling changes without changing the source or unrelated strings', () => {
  const original = { ...source(), label: 'useSkillContext' }
  const before = JSON.stringify(original)
  const result = repairSkillSelector(original)
  assert.equal(JSON.stringify(original), before)
  assert.deepEqual(result.paths, ['/apply/target'])
  assert.equal(result.definition.label, 'useSkillContext')
  assert.equal(result.definition.apply.target, 'usingSkillContext')
})
test('keeps direct owner admission distinct from skill identity admission', () => {
  assert.equal(classifySkillPower(source()).when, 'conditions.ownerUsesSkill')
  assert.equal(
    classifySkillPower({ ...source(), condition: { type: 'selfUseSkill' } }).when,
    'conditions.selfUsesSkill',
  )
  assert.equal(classifySkillPower({ ...source(), consumesStacks: 1 }).consumesStacks, 1)
})
test('rejects unsupported action shapes instead of emitting partial effects', () => {
  const d = source()
  for (const bad of [
    null,
    [],
    {},
    { ...d, trigger: 'OnDamage' },
    { ...d, extra: 1 },
    { ...d, consumesStacks: -1 },
    { ...d, tags: [1] },
    { ...d, apply: { ...d.apply, value: NaN } },
    { ...d, apply: { ...d.apply, value: [1, 2] } },
    { ...d, apply: { ...d.apply, target: { base: 'useSkillContext', chain: [] } } },
    {
      ...d,
      condition: {
        type: 'evaluate',
        target: { base: 'useSkillContext', chain: [{ type: 'selectPath', arg: 'skillId' }] },
        evaluator: { type: 'same', value: 'x' },
      },
    },
  ])
    assert.ok(classifySkillPower(bad).reason)
})
test('deterministically reproduces every candidate and rejected record', async () => {
  assert.deepEqual(await generateSkillPower({ check: true }), { generated: 104, rejected: 0 })
})

test('preserves skill ownership throughout nested conditional comparison values', () => {
  const d = source()
  d.condition = {
    type: 'evaluate',
    target: { base: 'self', chain: [{ type: 'select', arg: { type: 'base', arg: 'currentHp' } }] },
    evaluator: {
      type: 'compare',
      operator: '>',
      value: {
        type: 'conditional',
        condition: { type: 'checkSelf' },
        trueValue: 1,
        falseValue: { type: 'conditional', condition: { type: 'checkSelf' }, trueValue: 2, falseValue: 3 },
      },
    },
  }
  const r = classifySkillPower(d)
  assert.ok(!r.reason)
  assert.ok(r.when.includes('values.choose(conditions.ownerUsesSkill'))
  assert.ok(!r.when.includes('selfBeDamaged'))
  assert.equal(r.when.match(/conditions.ownerUsesSkill/g).length, 2)
})

test('does not invent an unimplemented category base extractor under C07', () => {
  const d = source()
  d.condition = {
    type: 'evaluate',
    target: { base: 'useSkillContext', chain: [{ type: 'select', arg: 'category' }] },
    evaluator: { type: 'same', value: 'Physical' },
  }
  assert.ok(classifySkillPower(d).reason)
  d.condition.target.chain[0].type = 'selectPath'
  assert.ok(!classifySkillPower(d).reason)
})

test('power dynamic collections pair operands by index, with missing RHS zero', () => {
  const d = source()
  d.apply.value = {
    type: 'dynamic',
    selector: {
      base: 'opponentMarks',
      chain: [
        { type: 'whereAttr', extractor: { type: 'base', arg: 'baseId' }, evaluator: { type: 'same', value: 'mark_x' } },
        { type: 'select', arg: { type: 'base', arg: 'stack' } },
        { type: 'multiply', arg: 15 },
      ],
    },
  }
  const r = classifySkillPower(d)
  assert.equal(
    r.value,
    'targets.opponentMarks.where(mark => mark.baseId === "mark_x").select(mark => mark.stack).all().map(items => items.map((n,index) => Math.floor(n * (index === 0 ? 15 : 0))))',
  )
  for (const step of [
    { type: 'unknown', arg: 1 },
    { type: 'divide', arg: 3 },
  ]) {
    const unsupported = structuredClone(d)
    unsupported.apply.value.selector.chain.push(step)
    assert.ok(classifySkillPower(unsupported).reason)
  }
})

test('maps ordered and periodic admission without admitting malformed conditions', () => {
  const d = source()
  for (const [type, code] of [
    ['isFirstSkillUsedThisTurn', 'conditions.firstSkillThisTurn'],
    ['isLastSkillUsedThisTurn', 'conditions.lastSkillThisTurn'],
  ]) {
    assert.equal(classifySkillPower({ ...d, condition: { type } }).when, code)
  }
  assert.equal(
    classifySkillPower({ ...d, condition: { type: 'continuousUseSkill', times: 2, strategy: 'Periodic' } }).when,
    'conditions.everyNthUse(2)',
  )
  assert.ok(
    classifySkillPower({ ...d, condition: { type: 'continuousUseSkill', times: 0, strategy: 'Periodic' } }).reason,
  )
  delete d.condition
  assert.equal(classifySkillPower(d).when, '() => true')
  assert.ok(classifySkillPower({ ...d, condition: null }).reason)
})

test('pins the complete C08 potential reference scope independently of converted candidates', async () => {
  const { generateTurnOrder } = await import('./turn-order.mjs')
  assert.deepEqual(await generateTurnOrder({ check: true }), { references: 27 })
})

test('keeps optional species fields out of equality, arithmetic and list-valued amounts', () => {
  const d = source()
  const target = { base: 'self', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'weight' } }] }
  d.condition = { type: 'evaluate', target, evaluator: { type: 'compare', operator: '>', value: 99 } }
  assert.ok(classifySkillPower(d).when.includes('pet.weight'))
  d.condition.evaluator.operator = '=='
  assert.ok(classifySkillPower(d).reason)
  d.condition.evaluator.operator = '>'
  target.chain.push({ type: 'multiply', arg: 2 })
  assert.ok(classifySkillPower(d).reason)
  target.chain.pop()
  d.condition = { type: 'checkSelf' }
  d.apply.value = { type: 'dynamic', selector: target }
  assert.ok(classifySkillPower(d).reason)
})

test('rejects nonexistent base extractors instead of extending C07', () => {
  for (const [base, arg] of [
    ['self', 'weight'],
    ['self', 'height'],
    ['self', 'level'],
    ['selfPlayer', 'maxRage'],
    ['battle', 'currentTurn'],
    ['self', 'lastSkillUsedTimes'],
  ]) {
    const d = source()
    d.condition = {
      type: 'evaluate',
      target: { base, chain: [{ type: 'select', arg: { type: 'base', arg } }] },
      evaluator: { type: 'compare', operator: '>', value: 1 },
    }
    assert.ok(classifySkillPower(d).reason, `${base}.${arg}`)
    d.condition.target.chain[0].arg.type = 'dynamic'
    assert.ok(!classifySkillPower(d).reason, `${base}.${arg} dynamic`)
  }
})

test('conditional power values preserve absent false-zero and lazy list branches', () => {
  const d = source()
  d.apply.value = {
    type: 'conditional',
    condition: { type: 'checkSelf' },
    trueValue: 0,
    falseValue: { type: 'conditional', condition: { type: 'selfUseSkill' }, trueValue: 50, falseValue: 0 },
  }
  assert.equal(
    classifySkillPower(d).value,
    'values.choose(conditions.ownerUsesSkill,[0],values.choose(conditions.selfUsesSkill,[50],[]))',
  )
  for (const bad of [null, false, [], { type: 'raw:number', value: 2 }]) {
    const invalid = structuredClone(d)
    invalid.apply.value.falseValue = bad
    assert.ok(classifySkillPower(invalid).reason)
  }
})

test('parameterized duration lists preserve indexed pairing and reject invalid extractors', () => {
  const d = source()
  d.apply.value = {
    type: 'dynamic',
    selector: {
      base: 'opponentMarks',
      chain: [
        { type: 'select', arg: { type: 'dynamic', arg: 'duration' } },
        { type: 'multiply', arg: { type: 'raw:number', value: 20, configId: 'factor', tags: ['power'] } },
      ],
    },
  }
  const r = classifySkillPower(d)
  assert.deepEqual(r.parameters, [{ name: 'amount_step1', value: 20, configId: 'factor', tags: ['power'] }])
  assert.equal(
    r.value,
    'values.combine(targets.opponentMarks.select(mark => mark.duration).all(),parameters.amount_step1,(items,factor) => items.map((n,index) => Math.floor(n * (index === 0 ? factor : 0))))',
  )
  d.apply.value.selector.chain[0].arg.type = 'base'
  assert.ok(classifySkillPower(d).reason)
})
test('parameterized probability preserves nested condition order and parameter tags', () => {
  const d = source()
  d.condition = {
    type: 'every',
    conditions: [
      { type: 'selfUseSkill' },
      {
        type: 'evaluate',
        target: 'self',
        evaluator: {
          type: 'probability',
          percent: { type: 'raw:number', value: 10, tags: ['skill_effect_probability'] },
        },
      },
    ],
  }
  const r = classifySkillPower(d)
  assert.equal(r.when, 'conditions.all(conditions.selfUsesSkill,conditions.chance(parameters.condition_1_percent))')
  assert.deepEqual(r.parameters, [{ name: 'condition_1_percent', value: 10, tags: ['skill_effect_probability'] }])
  d.condition.conditions[1].evaluator.percent.tags = [123]
  assert.ok(classifySkillPower(d).reason)
})

test('C09 is a nonmutating correction of exact named nodes, not a general path alias', () => {
  const d = source()
  d.id = 'effect_mark_amplify_non_yanggong'
  d.condition = {
    type: 'every',
    conditions: [
      { type: 'checkSelf' },
      { type: 'checkSelf' },
      {
        type: 'evaluate',
        target: {
          base: 'useSkillContext',
          chain: [
            { type: 'selectPath', arg: 'skillId' },
            { type: 'select', arg: 'baseId' },
          ],
        },
        evaluator: { type: 'notSame', value: 'skill_yanggong' },
      },
    ],
  }
  const before = structuredClone(d)
  const repaired = repairSkillPaths(d)
  assert.deepEqual(d, before)
  assert.deepEqual(repaired.changes, [
    { path: '/condition/conditions/2/target/chain/0/arg', before: 'skillId', after: 'skill' },
  ])
  assert.equal(repaired.definition.condition.conditions[2].target.chain[0].arg, 'skill')
  assert.ok(classifySkillPower(d).when.includes('skill.baseId !== "skill_yanggong"'))
  assert.ok(classifySkillPower({ ...d, id: 'unreviewed' }).reason)
  d.condition.conditions[2].target.chain[0].arg = 'anotherPath'
  assert.ok(classifySkillPower(d).reason.includes('C09 source node changed'))
})

test('C09 unknown IDs cannot resolve inherited object properties', () => {
  for (const id of ['toString', 'constructor', '__proto__']) {
    const d = { ...source(), id }
    assert.deepEqual(repairSkillPaths(d), { definition: d, changes: [] })
    assert.equal(classifySkillPower(d).id, id)
  }
})
