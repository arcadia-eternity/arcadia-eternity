import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
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
  assert.deepEqual(await generateSkillOutcome({ check: true }), { generated: 65, rejected: 0 }))
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

test('C08 admits only the recorded first-skill source nodes', () => {
  const d = {
    ...source(),
    id: 'effect_skill_crit_if_first',
    condition: { type: 'every', conditions: [{ type: 'selfUseSkill' }, { type: 'isFirstSkillUsedThisTurn' }] },
  }
  assert.deepEqual(classifySkillOutcome(d).orderConditions, [
    { path: '/condition/conditions/1', type: 'isFirstSkillUsedThisTurn' },
  ])
  for (const alter of [
    x => {
      x.id = 'unreviewed'
    },
    x => {
      x.condition.conditions.reverse()
    },
    x => {
      x.condition.conditions.push({ type: 'isFirstSkillUsedThisTurn' })
    },
    x => {
      x.condition.conditions[1] = { type: 'isLastSkillUsedThisTurn' }
    },
    x => {
      x.condition.conditions[1] = { type: 'not', condition: { type: 'isFirstSkillUsedThisTurn' } }
    },
    x => {
      x.condition.conditions.pop()
    },
  ]) {
    const copy = structuredClone(d)
    alter(copy)
    assert.ok(classifySkillOutcome(copy).reason)
  }
})

test('mark stack comparison consumes the complete selected collection', () => {
  const d = source()
  d.condition = {
    type: 'evaluate',
    target: { base: 'opponentMarks', chain: [{ type: 'select', arg: { type: 'base', arg: 'stack' } }] },
    evaluator: { type: 'compare', operator: '>=', value: 2 },
  }
  const r = classifySkillOutcome(d)
  assert.match(r.when, /\.all\(\)/)
  assert.match(r.when, /left.some/)
  assert.doesNotMatch(r.when, /\.first\(\)/)
})

test('C09 outcome paths are exact and do not mutate source definitions', async () => {
  const ids = new Set([
    'effect_emblem_immune_skill_bandao',
    'effect_skill_sure_hit_if_atk_over_500',
    'effect_skill_sure_hit_if_opponent_spa_gt_atk',
  ])
  let count = 0
  for (const file of ['emblem', 'skill'])
    for (const d of parse(await readFile(`packs/base/data/effect_${file}.yaml`, 'utf8'), { merge: true })) {
      if (!ids.has(d.id)) continue
      const original = structuredClone(d)
      const r = classifySkillOutcome(d)
      assert.ok(!r.reason, r.reason)
      assert.deepEqual(d, original)
      for (const repair of r.pathRepairs) {
        const changed = structuredClone(d)
        const parts = repair.path.slice(1).split('/')
        const key = parts.pop()
        parts.reduce((n, k) => n[k], changed)[key] = 'unreviewed'
        assert.match(classifySkillOutcome(changed).reason, /C09 source node changed/)
      }
      count++
    }
  assert.equal(count, 3)
})

test('defensive skill ownership and direct target checks stay separate', () => {
  const d = source()
  d.condition = { type: 'every', conditions: [{ type: 'opponentUseSkill' }, { type: 'selfBeSkillTarget' }] }
  assert.equal(
    classifySkillOutcome(d).when,
    'conditions.all(conditions.skillActorDiffersFromOwner,conditions.ownerIsSkillTarget)',
  )
})
