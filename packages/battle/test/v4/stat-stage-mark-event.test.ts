import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  AddMarkContext,
  BaseMark,
  BaseStatLevelMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedStatStageCandidates } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_ability_enhance_atk_when_spa_enhanced'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_ability.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
const corrected = structuredClone(original)
corrected.apply.value.selector.chain[0].arg = 'stack'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
it('pins the original missing property and the exact independent correction', () => {
  expect(original.apply.value.selector.chain[0].arg).toBe('statLevelMarkLevel')
  expect(() => EffectParser.parse(original)).toThrow(/statLevelMarkLevel/)
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/stat-stages-candidates.json', import.meta.url), 'utf8'),
  )
  const r = ledger.records.find((r: { id: string }) => r.id === id)
  expect(r.recipe.pathRepairs).toEqual([
    { path: '/apply/value/selector/chain/0/arg', before: 'statLevelMarkLevel', after: 'stack' },
  ])
  expect(r.recipe.additionalDecisions).toEqual(['C09'])
})
const variants = [
  'normal',
  'other-target',
  'other-applicant',
  'down',
  'negative-stack',
  'zero-base',
  'other-stat',
  'ordinary-mark',
  'late-stack',
  'late-owner',
  'late-base',
  'cancel',
  'nested',
  'missing',
  'real',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const f = makeScenario(301),
    { battle, a, b } = f
  battles.push(battle)
  const pet = a.activePet,
    skill = pet.skills[0]
  skill.effects.splice(0)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  let source: typeof skill | (typeof pet.marks)[number] = skill
  if (kind === 'mark') {
    const base = new BaseMark('fixture/echo' as baseMarkId, [], f.debuff.config)
    battle.addMark(new AddMarkContext(setup, pet, base))
    source = pet.marks.find(m => m.base === base)!
  }
  source.effects.push(native ? generatedStatStageCandidates.effects[id] : EffectParser.parse(corrected))
  const applicant = variant === 'other-applicant' ? b.activePet.skills[0] : skill
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, applicant)
  const base =
    variant === 'ordinary-mark'
      ? f.debuff
      : new BaseStatLevelMark(
          variant === 'other-stat' ? StatTypeWithoutHp.spd : StatTypeWithoutHp.spa,
          variant === 'down' ? -2 : variant === 'zero-base' ? 0 : 2,
          'fixture/stage' as baseMarkId,
        )
  const event = new AddMarkContext(
    parent,
    variant === 'other-target' ? b.activePet : pet,
    base,
    variant === 'negative-stack' ? -2 : 2,
  )
  let applications = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/echo-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply(ctx) {
        applications++
        if (variant === 'late-stack') event.stack = 4
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-base') event.baseMark = f.debuff
        if (variant === 'cancel' && ctx.parent instanceof EffectContext) ctx.parent.available = false
      },
    }),
  )
  if (variant === 'real') battle.addMark(event)
  else
    battle.applyEffects<EffectTrigger>(
      variant === 'missing'
        ? new TurnContext(battle)
        : variant === 'nested'
          ? new EffectContext(event, EffectTrigger.BeforeEffect, source)
          : event,
      EffectTrigger.OnBeforeAddMark,
      source,
    )
  return {
    applications,
    levels: [...a.team, ...b.team].map(p =>
      p.marks
        .filter(
          (m): m is StatLevelMarkInstanceImpl =>
            m instanceof StatLevelMarkInstanceImpl && m.statType === StatTypeWithoutHp.atk,
        )
        .map(m => m.level),
    ),
    nextRandom: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  it.each(variants)(`mark-stage ${kind}: %s`, variant => {
    const actual = run(true, kind, variant)
    expect(actual).toEqual(run(false, kind, variant))
    const denied = [
      'other-applicant',
      'down',
      'zero-base',
      'other-stat',
      'ordinary-mark',
      'nested',
      'missing',
    ].includes(variant)
    expect(actual.applications).toBe(denied ? 0 : 1)
    const expected: number[][] = [[], [], [], []]
    if (!denied && variant !== 'cancel')
      expected[variant === 'late-owner' ? 1 : 0] = [
        variant === 'late-stack' ? 4 : variant === 'negative-stack' ? -2 : 2,
      ]
    expect(actual.levels).toEqual(expected)
  })
it('reuses nearest mark queries independently while admission keeps the direct-event boundary', () => {
  const { battle, a, debuff } = makeScenario()
  battles.push(battle)
  const skill = a.activePet.skills[0],
    observed: unknown[] = []
  const { compileEffect, defineEffect, contexts, conditions } = effectAuthoring
  const query = contexts.addMark.select(event => event.stack).first()
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/query',
      triggers: [EffectTrigger.TurnStart],
      apply(ctx) {
        observed.push(ctx.read(query), conditions.ownerAddsMark(ctx))
        const event = ctx.read(contexts.addMark.first())
        if (event) event.stack = 5
        observed.push(ctx.read(query))
      },
    }),
  )
  skill.effects.splice(0, skill.effects.length, effect)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const event = new AddMarkContext(setup, a.activePet, debuff, 2)
  battle.applyEffects<EffectTrigger>(
    new EffectContext(event, EffectTrigger.BeforeEffect, skill),
    EffectTrigger.TurnStart,
    skill,
  )
  battle.applyEffects<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  expect(observed).toEqual([2, false, 5, undefined, false, undefined])
})
