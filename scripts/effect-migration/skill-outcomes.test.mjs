import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySkillOutcome, generateSkillOutcome } from './skill-outcomes.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'AfterUseSkillCheck',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'setSureHit', target: 'useSkillContext', priority: 2 },
})
test('explicit C07 outcome mapping retains action priority and source metadata', () => {
  const d = { ...source(), consumesStacks: 1, tags: ['fixture'] },
    before = structuredClone(d),
    r = classifySkillOutcome(d)
  assert.deepEqual(d, before)
  assert.equal(r.amount, 2)
  assert.equal(r.priority, 0)
  assert.equal(r.consumesStacks, 1)
  assert.deepEqual(r.tags, ['fixture'])
  assert.deepEqual(r.repairedPaths, ['/apply/target'])
})
test('rejects unknown shape, nonfinite priorities, unmapped timing and conditional values', () => {
  for (const change of [
    d => {
      d.apply.priority = Infinity
    },
    d => {
      d.apply.extra = 1
    },
    d => {
      d.apply.target = { base: 'useSkillContext', chain: [] }
    },
    d => {
      d.trigger = 'OnDamage'
    },
    d => {
      d.condition = { type: 'not', condition: { type: 'isFirstSkillUsedThisTurn' } }
    },
    d => {
      d.consumesStacks = -1
    },
    d => {
      d.tags = [1]
    },
    d => {
      d.apply = {
        type: 'addAccuracy',
        target: 'useSkillContext',
        value: { type: 'conditional', condition: { type: 'selfUseSkill' }, trueValue: 5, falseValue: 0 },
      }
    },
  ]) {
    const d = source()
    change(d)
    assert.ok(classifySkillOutcome(d).reason)
  }
})
test('numeric lists preserve per-operation runtime consumption', () => {
  for (const type of ['addAccuracy', 'addCritRate']) {
    const d = {
      ...source(),
      apply: {
        type,
        target: 'useSkillContext',
        value: {
          type: 'dynamic',
          selector: { base: 'selfMarks', chain: [{ type: 'select', arg: { type: 'base', arg: 'stack' } }] },
        },
      },
    }
    assert.match(classifySkillOutcome(d).value, /\.all\(\)/)
  }
})
test('reproduces current outcome source and ledger', async () =>
  assert.deepEqual(await generateSkillOutcome({ check: true }), { generated: 51, rejected: 14 }))
test('checkSelf uses direct-event ownership while consecutive-use checks stay skill-specific', () => {
  const d = source()
  d.condition = { type: 'every', conditions: [{ type: 'checkSelf' }, { type: 'continuousUseSkill' }] }
  const r = classifySkillOutcome(d)
  assert.match(r.when, /conditions.sourceOwnsEvent/)
  assert.match(r.when, /conditions.ownerUsesSkill/)
  assert.match(
    classifySkillOutcome({ ...d, condition: { type: 'not', condition: { type: 'checkSelf' } } }).when,
    /conditions.not\(conditions.sourceOwnsEvent\)/,
  )
})
test('event ownership propagates through conditional probabilities and compare values', () => {
  const branch = { type: 'conditional', condition: { type: 'checkSelf' }, trueValue: 100, falseValue: 1 }
  for (const value of [branch, { ...branch, trueValue: branch }])
    for (const evaluator of [
      { type: 'probability', percent: value },
      { type: 'compare', operator: '>', value },
    ]) {
      const d = source()
      d.condition = {
        type: 'evaluate',
        target:
          evaluator.type === 'probability'
            ? 'self'
            : { base: 'self', chain: [{ type: 'select', arg: { type: 'base', arg: 'currentHp' } }] },
        evaluator,
      }
      const r = classifySkillOutcome(d)
      assert.ok(!r.reason, r.reason)
      assert.match(r.when, /sourceOwnsEvent/)
      assert.doesNotMatch(r.when, /ownerUsesSkill/)
    }
})
