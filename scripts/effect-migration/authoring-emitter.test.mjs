import { test } from 'node:test'
import assert from 'node:assert/strict'
import { condition } from './authoring-emitter.mjs'

test('element equality retains first-item and empty-selection semantics', () => {
  for (const base of ['self', 'opponent'])
    for (const type of ['same', 'notSame']) {
      const input = {
        type: 'evaluate',
        target: { base, chain: [{ type: 'select', arg: { type: 'base', arg: 'element' } }] },
        evaluator: { type, value: 'Water' },
      }
      const expression = condition(input, 'skill')
      const selector = { condition: callback => callback }
      const predicate = new Function('targets', `return ${expression}`)({
        ownerPet: selector,
        opponentActive: selector,
      })
      for (const items of [
        [],
        [{ element: 'Water' }],
        [{ element: 'Fire' }],
        [{ element: 'Fire' }, { element: 'Water' }],
      ])
        assert.equal(
          predicate({}, items),
          type === 'same' ? items[0]?.element === 'Water' : items[0]?.element !== 'Water',
        )
      assert.equal(condition({ ...input, evaluator: { ...input.evaluator, unexpected: true } }, 'skill'), undefined)
      assert.equal(condition(input, 'damage'), undefined)
    }
})

test('consecutive-use defaults and strategies preserve the direct skill-owner counter', () => {
  for (const input of [
    { type: 'continuousUseSkill' },
    { type: 'continuousUseSkill', times: 3, strategy: 'Continuous' },
    { type: 'continuousUseSkill', times: 3, strategy: 'Once' },
  ]) {
    const expression = condition(input, 'skill')
    const predicate = new Function('conditions', 'contexts', `return ${expression}`)(
      {
        ownerUsesSkill: ctx => ctx.owned,
        all:
          (...items) =>
          ctx =>
            items.every(item => item(ctx)),
      },
      { skillUse: { condition: callback => ctx => callback(ctx, ctx.events) } },
    )
    for (const owned of [true, false])
      for (const count of [0, 1, 2, 3, 4]) {
        const expected = input.strategy === 'Once' ? count === input.times : count >= (input.times ?? 2)
        assert.equal(
          predicate({ owned, events: [{ skill: { owner: { lastSkillUsedTimes: count } } }] }),
          owned && expected,
        )
      }
    assert.equal(predicate({ owned: true, events: [{ skill: {} }] }), false)
    assert.equal(predicate({ owned: false, events: [] }), false)
  }
  for (const input of [
    { type: 'continuousUseSkill', times: 0 },
    { type: 'continuousUseSkill', times: null },
    { type: 'continuousUseSkill', strategy: null },
    { type: 'continuousUseSkill', times: { type: 'raw:number', value: 2 } },
    { type: 'continuousUseSkill', strategy: 'Other' },
    { type: 'continuousUseSkill', extra: true },
  ])
    assert.equal(condition(input, 'skill'), undefined)
})

test('field mark membership composes the shared expansion and filter query', () => {
  const input = {
    type: 'evaluate',
    target: {
      base: 'battle',
      chain: [
        { type: 'select', arg: { type: 'base', arg: 'marks' } },
        { type: 'flat' },
        { type: 'whereAttr', extractor: 'baseId', evaluator: { type: 'same', value: 'field/night' } },
      ],
    },
    evaluator: { type: 'exist' },
  }
  const code = condition(input, 'skill')
  assert.equal(
    code,
    'contexts.battle.flatMap(battle => battle.marks).where(mark => mark.baseId === "field/night").condition(checks.exists())',
  )
  assert.equal(condition(input, 'damage'), undefined)
  assert.equal(
    condition({ ...input, target: { ...input.target, chain: input.target.chain.slice(1) } }, 'skill'),
    undefined,
  )
  assert.equal(
    condition({ ...input, target: { ...input.target, chain: [...input.target.chain, { type: 'shuffled' }] } }, 'skill'),
    undefined,
  )
})
