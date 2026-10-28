import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseSkill,
  BaseMark,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Category,
  Element,
  SkillPhase,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseSkillId,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createSkillTransformationRemoval } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_clear_transform_when_use'
const definition = (
  parse(readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'), {
    merge: true,
  }) as { id: string }[]
).find(d => d.id === id)!
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  vi.restoreAllMocks()
})
const variants = [
  'normal',
  'none',
  'two',
  'same-source',
  'repeat',
  'permanent',
  'wrong-owner',
  'wrong-skill',
  'nested',
  'cancel',
  'late-transform',
  'phase-hit',
  'phase-miss',
  'phase-disabled',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const { battle, a, b, debuff } = makeScenario(725)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const skill = a.activePet.skills[0],
    original = skill.base
  const replacement = new BaseSkill(
    'fixture/replacement' as baseSkillId,
    Category.Physical,
    Element.Normal,
    25,
    100,
    0,
    0,
    AttackTargetOpinion.opponent,
    1,
    true,
  )
  const second = new BaseSkill(
    'fixture/second' as baseSkillId,
    Category.Special,
    Element.Normal,
    50,
    100,
    0,
    0,
    AttackTargetOpinion.opponent,
    1,
    true,
  )
  const mark = new BaseMark('fixture/transform-source' as baseMarkId, [], debuff.config).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = kind === 'skill' ? skill : mark
  source.effects.push(native ? createSkillTransformationRemoval() : EffectParser.parse(definition))
  if (variant !== 'none')
    expect(
      battle.transformationSystem.applyTransformation(
        skill,
        replacement,
        variant === 'permanent' ? 'permanent' : 'temporary',
        10,
        source,
      ),
    ).toBe(true)
  if (variant === 'two' || variant === 'repeat' || variant === 'same-source')
    expect(
      battle.transformationSystem.applyTransformation(
        skill,
        second,
        'temporary',
        20,
        variant === 'same-source' ? source : b.activePet.skills[0],
      ),
    ).toBe(true)
  const other = new SkillInstance(original)
  other.setOwner(a.activePet)
  a.activePet.skills.push(other)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : a.activePet,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? other : skill,
  )
  use.updateActualTarget()
  use.hitOverrides.push({ willHit: variant !== 'phase-miss', priority: 1000 })
  use.available = variant !== 'phase-disabled'
  a.currentRage = a.maxRage
  b.activePet.attributeSystem.updateBaseValue('maxHp', 10000)
  b.activePet.currentHp = 10000
  const trace: unknown[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/transform-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        trace.push(['before', skill.baseId])
        if (ctx.parent instanceof EffectContext && variant === 'cancel') ctx.parent.available = false
        if (variant === 'late-transform')
          battle.transformationSystem.applyTransformation(skill, second, 'temporary', 20, b.activePet.skills[0])
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.TransformEnd) trace.push(['removed', message.data.fromBase, skill.baseId])
    if (message.type === BattleMessageType.SkillUseEnd) trace.push(['end', skill.baseId])
  })
  if (variant.startsWith('phase-')) {
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.SkillUseEnd, source) : use
    battle.applyEffects(parent, EffectTrigger.SkillUseEnd as EffectTrigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger.SkillUseEnd as EffectTrigger, source)
  }
  return {
    base: skill.baseId,
    power: skill.power,
    category: skill.category,
    effects: skill.effects.map(e => e.id),
    trace,
    next: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  for (const variant of variants)
    it(`transformation removal ${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      const retained = kind === 'mark' || ['wrong-owner', 'wrong-skill', 'cancel', 'phase-disabled'].includes(variant)
      const expected =
        variant === 'none'
          ? 'fixture/setup'
          : retained
            ? variant === 'two' || variant === 'repeat' || variant === 'same-source'
              ? 'fixture/second'
              : variant === 'late-transform'
                ? 'fixture/second'
                : 'fixture/replacement'
            : variant === 'two' || variant === 'late-transform'
              ? 'fixture/replacement'
              : 'fixture/setup'
      expect(actual.base).toBe(expected)
      if (variant === 'phase-hit' || variant === 'phase-miss') expect(actual.trace.at(-1)).toEqual(['end', actual.base])
    })
it('rejects a foreign skill before removing any selected transformation', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const own = makeScenario(726),
    foreign = makeScenario(727)
  battles.push(own.battle, foreign.battle)
  const skill = own.a.activePet.skills[0],
    base = own.a.team[1].skills[0].base
  own.battle.transformationSystem.applyTransformation(skill, base, 'temporary')
  const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/foreign-transform',
      triggers: [EffectTrigger.TurnEnd],
      apply: selectFrom([skill, foreign.a.activePet.skills[0]]).apply(ops.removeSkillTransformation()),
    }),
  )
  const ctx = new EffectContext(new TurnContext(own.battle), EffectTrigger.TurnEnd, skill, effect)
  expect(() => own.battle.executionBudget.run(0, () => effect.innerApply(ctx))).toThrow('Cross-battle')
  expect(skill.base).toBe(base)
})

for (const variant of ['foreign', 'foreign-after-read', 'missing', 'two-targets'] as const)
  it(`transformation prototype read boundary: ${variant}`, () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const own = makeScenario(728),
      foreign = makeScenario(729)
    battles.push(own.battle, foreign.battle)
    const first = own.a.activePet.skills[0],
      second = own.a.team[1].skills[0]
    const initial = first.base,
      replacement = second.base
    if (variant === 'foreign') second.owner = foreign.a.activePet
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    let reads = 0
    const prototype = selectFrom(variant === 'missing' ? [] : [replacement])
      .select(base => {
        reads++
        if (variant === 'foreign-after-read') second.owner = foreign.a.activePet
        return base
      })
      .first()
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/transform-read',
        triggers: [EffectTrigger.TurnEnd],
        apply: selectFrom([first, second]).apply(ops.transformSkill(prototype)),
      }),
    )
    const ctx = new EffectContext(new TurnContext(own.battle), EffectTrigger.TurnEnd, first, effect)
    const apply = () => own.battle.executionBudget.run(0, () => effect.innerApply(ctx))
    if (variant.startsWith('foreign')) expect(apply).toThrow('Cross-battle')
    else apply()
    expect(reads).toBe(variant === 'foreign' || variant === 'missing' ? 0 : 1)
    expect(first.base).toBe(variant === 'two-targets' ? replacement : initial)
    if (variant === 'two-targets')
      for (const skill of [first, second])
        expect(own.battle.transformationSystem.getTransformationState(skill).currentTransformations).toHaveLength(1)
  })
