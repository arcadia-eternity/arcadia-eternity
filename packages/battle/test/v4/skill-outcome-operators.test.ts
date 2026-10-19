import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  type baseSkillId,
  AddMarkContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const { compileEffect, defineEffect, contexts, targets, ops, selectFrom } = effectAuthoring
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const operations = [
  'addCritRate',
  'addAccuracy',
  'setAccuracy',
  'setSureHit',
  'setSureMiss',
  'setSureCrit',
  'setSureNoCrit',
] as const
const variants = ['normal', 'nested', 'missing', 'late-value', 'empty', 'cancel', 'compete', 'tie'] as const
function run(
  native: boolean,
  operation: (typeof operations)[number],
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
) {
  const f = makeScenario(301),
    { battle, a, b } = f
  battles.push(battle)
  const pet = a.activePet
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/outcome-skill' as baseSkillId,
      Category.Physical,
      Element.Normal,
      10,
      50,
      0,
      0,
      AttackTargetOpinion.opponent,
    ),
  )
  skill.owner = pet
  pet.skills[0] = skill
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  let source: typeof skill | (typeof pet.marks)[number] = skill
  if (kind === 'mark') {
    const base = new BaseMark('fixture/outcome-source' as baseMarkId, [], f.debuff.config)
    battle.addMark(new AddMarkContext(setup, pet, base))
    source = pet.marks.find(m => m.base === base)!
  }
  const amounts = [20, 30].map((stack, i) => {
    const mark = new BaseMark(`fixture/value-${i}` as baseMarkId, [], f.debuff.config, [
      'outcome-value',
    ]).createInstance()
    mark.owner = pet
    mark.stack = stack
    pet.marks.push(mark)
    return mark
  })
  if (variant === 'empty') pet.marks = pet.marks.filter(m => !amounts.some(amount => amount === m))
  const numeric = ['addCritRate', 'addAccuracy', 'setAccuracy'].includes(operation)
  const query = targets.ownerMarks
    .where(m => m.tags.includes('outcome-value'))
    .select(m => m.stack)
    .all()
  const priority = variant === 'normal' ? undefined : 2
  const effect = native
    ? compileEffect(
        defineEffect({
          id: 'fixture/outcome',
          on: 'BeforeHit',
          execute: contexts.skillUse.apply(
            operation === 'addCritRate'
              ? ops.addCritRate(query)
              : operation === 'addAccuracy'
                ? ops.addAccuracy(query)
                : operation === 'setAccuracy'
                  ? ops.setAccuracy(query)
                  : ops[operation](priority),
          ),
        }),
      )
    : EffectParser.parse({
        id: 'fixture/outcome',
        trigger: 'BeforeHit',
        priority: 0,
        apply: {
          type: operation,
          target: 'usingSkillContext',
          ...(numeric
            ? {
                value: {
                  type: 'dynamic',
                  selector: {
                    base: 'selfMarks',
                    chain: [
                      {
                        type: 'whereAttr',
                        extractor: { type: 'base', arg: 'tags' },
                        evaluator: { type: 'contain', tag: 'outcome-value' },
                      },
                      { type: 'select', arg: { type: 'base', arg: 'stack' } },
                    ],
                  },
                },
              }
            : { priority: priority ?? (operation === 'setSureMiss' || operation === 'setSureNoCrit' ? -1 : 0) }),
        },
      })
  source.effects.push(effect)
  const use = new UseSkillContext(new TurnContext(battle), a, pet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  use.accuracy = 50
  use.critRate = 40
  if (variant === 'compete' || variant === 'tie') {
    use.hitOverrides.push({ willHit: operation !== 'setSureHit', priority: variant === 'compete' ? 3 : 2 })
    use.critOverrides.push({ willCrit: operation !== 'setSureCrit', priority: variant === 'compete' ? 3 : 2 })
  }
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/outcome-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === 'fixture/outcome',
      apply(ctx) {
        if (variant === 'late-value') amounts[0].stack = 10
        if (variant === 'cancel' && ctx.parent instanceof EffectContext) ctx.parent.available = false
      },
    }),
  )
  battle.applyEffects<EffectTrigger>(
    variant === 'missing'
      ? new TurnContext(battle)
      : variant === 'nested'
        ? new EffectContext(use, EffectTrigger.BeforeEffect, source)
        : use,
    EffectTrigger.BeforeHit,
    source,
  )
  use.updateHitResult()
  use.updateCritResult()
  return {
    accuracy: use.accuracy,
    critRate: use.critRate,
    hit: use.hitResult,
    crit: use.crit,
    hitOverrides: use.hitOverrides,
    critOverrides: use.critOverrides,
    nextRandom: battle.random(),
  }
}
for (const operation of operations)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${operation} ${kind}: %s`, variant => {
      const actual = run(true, operation, kind, variant)
      expect(actual).toEqual(run(false, operation, kind, variant))
      if (variant === 'normal' || variant === 'nested') {
        if (operation === 'addCritRate') expect(actual.critRate).toBe(90)
        if (operation === 'addAccuracy') expect(actual.accuracy).toBe(70)
        if (operation === 'setAccuracy') expect(actual.accuracy).toBe(20)
        if (operation === 'setSureHit') expect(actual.hit).toBe(true)
        if (operation === 'setSureMiss') expect(actual.hit).toBe(false)
        if (operation === 'setSureCrit') expect(actual.crit).toBe(true)
        if (operation === 'setSureNoCrit') expect(actual.crit).toBe(false)
      }
      if (variant === 'tie' || variant === 'compete') {
        const wins = variant === 'tie'
        if (operation === 'setSureHit') expect(actual.hit).toBe(wins)
        if (operation === 'setSureMiss') expect(actual.hit).toBe(!wins)
        if (operation === 'setSureCrit') expect(actual.crit).toBe(wins)
        if (operation === 'setSureNoCrit') expect(actual.crit).toBe(!wins)
      }
    })
it.each(['addCritRate', 'addAccuracy', 'setAccuracy'] as const)(
  'pins %s query counts across two contexts',
  operation => {
    const { battle, a } = makeScenario()
    battles.push(battle)
    const skill = a.activePet.skills[0],
      turn = new TurnContext(battle)
    const events = [0, 1].map(() => new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill))
    events.forEach(event => {
      event.accuracy = 50
      event.critRate = 40
    })
    let reads = 0
    const values = selectFrom([0])
      .select(() => {
        reads++
        return [80, -30]
      })
      .first()
    const effect = compileEffect(
      defineEffect({ id: 'fixture/count', on: 'TurnStart', execute: selectFrom(events).apply(ops[operation](values)) }),
    )
    skill.effects.splice(0, skill.effects.length, effect)
    battle.applyEffects(turn, EffectTrigger.TurnStart, skill)
    expect(reads).toBe(operation === 'addCritRate' ? 2 : 1)
    expect(events.map(e => (operation === 'addCritRate' ? e.critRate : e.accuracy))).toEqual(
      operation === 'addCritRate' ? [70, 70] : operation === 'addAccuracy' ? [100, 100] : [80, 80],
    )
  },
)
it.each(['setSureHit', 'setSureMiss', 'setSureCrit', 'setSureNoCrit'] as const)(
  '%s rejects nonfinite priorities',
  operation => {
    for (const priority of [NaN, Infinity, -Infinity])
      expect(() => ops[operation](priority)).toThrow(/finite override priority/)
  },
)
it.each(operations)('%s rejects foreign contexts without changing them', operation => {
  const f = makeScenario(),
    other = makeScenario()
  battles.push(f.battle, other.battle)
  const skill = f.a.activePet.skills[0]
  const foreign = new UseSkillContext(
    new TurnContext(other.battle),
    other.a,
    other.a.activePet,
    AttackTargetOpinion.opponent,
    other.a.activePet.skills[0],
  )
  foreign.accuracy = 50
  foreign.critRate = 40
  const apply = ops[operation](10)
  let checked = false
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/foreign-outcome',
      on: 'TurnStart',
      execute(ctx) {
        expect(() => apply(ctx, [foreign])).toThrow(/Cross-battle skill context/)
        checked = true
      },
    }),
  )
  skill.effects.splice(0, skill.effects.length, effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnStart, skill)
  expect(checked).toBe(true)
  expect([foreign.accuracy, foreign.critRate, foreign.hitOverrides, foreign.critOverrides]).toEqual([50, 40, [], []])
})
it.each(operations)('%s preserves the RNG draw count of hit and critical resolution', operation => {
  const actual = run(true, operation, 'skill', 'normal')
  const f = makeScenario(301)
  battles.push(f.battle)
  // Numeric changes still resolve hit and crit by RNG; an override bypasses only its own roll.
  const count = operation.startsWith('setSure') ? 1 : 2
  for (let i = 0; i < count; i++) f.battle.random()
  expect(actual.nextRandom).toBe(f.battle.random())
})
it.each(['addCritRate', 'addAccuracy', 'setAccuracy'] as const)('%s keeps empty-target read timing', operation => {
  const f = makeScenario()
  battles.push(f.battle)
  const skill = f.a.activePet.skills[0]
  let reads = 0
  const query = selectFrom([1])
    .select(() => {
      reads++
      return 5
    })
    .first()
  const apply = ops[operation](query)
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/empty-outcome',
      on: 'TurnStart',
      execute(ctx) {
        apply(ctx, [])
      },
    }),
  )
  skill.effects.splice(0, skill.effects.length, effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnStart, skill)
  expect(reads).toBe(operation === 'addCritRate' ? 0 : 1)
})
