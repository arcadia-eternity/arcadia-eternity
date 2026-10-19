import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySkillPower, generateSkillPower, repairSkillSelector } from './skill-power.mjs'
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
  assert.deepEqual(await generateSkillPower({ check: true }), { generated: 71, rejected: 33 })
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
