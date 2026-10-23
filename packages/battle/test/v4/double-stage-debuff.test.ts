import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { Conditions, EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  BaseStatLevelMark,
  StatLevelMarkInstanceImpl,
  Effect,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  StatTypeWithoutHp,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createDoubleStageDebuff } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_double_stage_debuff'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'),
  {
    merge: true,
  },
).find((d: { id: string }) => d.id === id)
function reference() {
  // Explicit typed-reader correction: the old metadata cannot narrow BaseMark.
  // Keep the original condition/operator implementations for the rest of the path.
  return new Effect<EffectTrigger>(
    id as effectId,
    [EffectTrigger.OnBeforeAddMark],
    ctx => {
      if (!(ctx.parent instanceof AddMarkContext)) throw new Error('Expected add-mark event')
      const event = ctx.parent
      const level =
        event.baseMark instanceof BaseStatLevelMark ? Math.floor(event.baseMark.initialLevel * 2) : undefined
      Operators.setStatLevelMarkLevel(level === undefined ? [] : [level])(ctx, [event])
    },
    0,
    Conditions.every(Conditions.selfAddMark(), Conditions.statStageChange(undefined, 'down')),
  )
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'positive',
  'zero',
  'wrong-applicant',
  'nested',
  'cancel',
  'late-level',
  'late-positive',
  'late-stack',
  'late-kind',
  'existing',
  'repeat',
] as const
function run(
  native: boolean,
  stat: StatTypeWithoutHp,
  recipient: 'self' | 'opponent',
  variant: (typeof variants)[number],
) {
  const { battle, a, b, debuff } = makeScenario()
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const source = new BaseMark('fixture/double-stage' as baseMarkId, [], debuff.config).createInstance()
  source.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(source)
  const effect = native ? createDoubleStageDebuff() : reference()
  source.effects.push(effect)
  const applicant = variant === 'wrong-applicant' ? b.activePet.skills[0] : a.activePet.skills[0]
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, applicant)
  const target = recipient === 'self' ? a.activePet : b.activePet
  const level = variant === 'positive' ? 1 : variant === 'zero' ? 0 : -1
  const base = new BaseStatLevelMark(stat, level, `stat_stage_${stat}_${level > 0 ? 'up' : 'down'}` as baseMarkId)
  const event = new AddMarkContext(parent, target, base, level)
  if (variant === 'existing') {
    source.effects.splice(0)
    target.addStatStage(parent, stat, -3)
    source.effects.push(effect)
  }
  let applications = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/double-stage-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        applications++
        if (variant === 'cancel' && ctx.parent instanceof EffectContext) ctx.parent.available = false
        if (variant === 'late-level') event.baseMark = new BaseStatLevelMark(stat, -3, base.id)
        if (variant === 'late-positive') event.baseMark = new BaseStatLevelMark(stat, 2, base.id)
        if (variant === 'late-stack') event.stack = 5
        if (variant === 'late-kind') event.baseMark = new BaseMark(base.id, [], debuff.config)
      },
    }),
  )
  if (variant === 'nested') {
    battle.applyEffects(
      new EffectContext(event, EffectTrigger.OnBeforeAddMark, source),
      EffectTrigger.OnBeforeAddMark as EffectTrigger,
      source,
    )
  } else {
    battle.addMark(event)
    if (variant === 'repeat')
      battle.addMark(new AddMarkContext(parent, target, new BaseStatLevelMark(stat, -1, base.id), -1))
  }
  return {
    applications,
    initial: event.baseMark instanceof BaseStatLevelMark ? event.baseMark.initialLevel : null,
    stack: event.stack,
    baseUnchanged: base.initialLevel,
    stage: target.marks.reduce(
      (sum, mark) => sum + (mark instanceof StatLevelMarkInstanceImpl && mark.base.statType === stat ? mark.level : 0),
      0,
    ),
  }
}
it('pins the explicit signed-level correction', () => {
  expect(() => EffectParser.parse(original)).toThrow()
  const d = structuredClone(original)
  expect(d.apply.value.selector.chain[0].arg).toBe('statLevelMarkLevel')
  d.apply.value.selector.chain[0].arg = 'baseMark.initialLevel'
  expect(() => EffectParser.parse(d)).toThrow()
  expect(() => reference()).not.toThrow()
})
for (const stat of [
  StatTypeWithoutHp.atk,
  StatTypeWithoutHp.def,
  StatTypeWithoutHp.spa,
  StatTypeWithoutHp.spd,
  StatTypeWithoutHp.spe,
])
  for (const recipient of ['self', 'opponent'] as const)
    it.each(variants)(`${stat} ${recipient}: %s`, variant => {
      const actual = run(true, stat, recipient, variant)
      expect(actual).toEqual(run(false, stat, recipient, variant))
      if (variant === 'normal' || variant === 'late-stack') {
        expect(actual.initial).toBe(-2)
        expect(actual.stack).toBe(2)
        expect(actual.stage).toBe(-2)
        expect(actual.baseUnchanged).toBe(-1)
      }
      if (variant === 'late-level') expect(actual.stage).toBe(-6)
      if (variant === 'late-positive') expect(actual.stage).toBe(4)
      if (variant === 'existing') expect(actual.stage).toBe(-5)
      if (variant === 'repeat') expect(actual.stage).toBe(-4)
      if (['positive', 'zero', 'wrong-applicant', 'nested'].includes(variant)) expect(actual.applications).toBe(0)
    })
