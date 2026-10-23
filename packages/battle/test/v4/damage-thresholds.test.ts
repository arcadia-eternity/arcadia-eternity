import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamagePhase,
  DamageType,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedDamageThresholds } from '@arcadia-eternity/data-pack-base/native'

type Id = keyof typeof generatedDamageThresholds
const ids = Object.keys(generatedDamageThresholds) as Id[]
const definitions = ['mark', 'skill'].flatMap(name =>
  parse(readFileSync(new URL(`./fixtures/effect-regression/effect_${name}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const originals = new Map(ids.map(id => [id, definitions.find(d => d.id === id)]))
const oracles = new Map(ids.map(id => [id, EffectParser.parse(originals.get(id))]))
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = [
  'normal',
  'cancel',
  'wrong-owner',
  'missing-support',
  'late-support',
  'late-hp',
  'late-maxhp',
  'late-owner',
  'late-slot',
  'nested',
  'repeat',
  'phase',
  'skill-source-phase',
  'effect-phase',
  'lower-last',
  'upper-last',
] as const
function run(native: boolean, id: Id, markSource: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(1501)
  battles.push(battle)
  for (const player of [a, b])
    for (const [i, p] of player.team.entries()) {
      for (const s of p.skills) s.effects.splice(0)
      p.attributeSystem.updateBaseValue('maxHp', i === 0 ? 2001 : 1001)
      p.currentHp = i === 0 ? 1500 : 700
    }
  const mark = new BaseMark('fixture/threshold' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = markSource ? mark : a.activePet.skills[0]
  source.effects.push(native ? generatedDamageThresholds[id] : oracles.get(id)!)
  const support = new BaseMark('mark_aideminyi' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  support.setOwner(a.activePet, battle.emitter)
  if (variant !== 'missing-support') a.activePet.marks.push(support)
  const cap = id === 'effect_mark_damage_cap_half_max_hp',
    save = id === 'effect_skill_save_hp_to_1'
  const attacker = cap ? b : a,
    victim = cap ? a : b,
    actor = variant === 'wrong-owner' ? victim : attacker
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, actor, actor.activePet, AttackTargetOpinion.opponent, actor.activePet.skills[0])
  use.updateActualTarget()
  const target = variant === 'wrong-owner' ? attacker.activePet : victim.activePet
  const baseDamage = cap || save ? 2000 : 20
  let event = new DamageContext(use, actor.activePet, target, baseDamage, DamageType.Effect)
  event.minThreshold = 10
  event.maxThreshold = 5000
  event.damageResult = 123
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/threshold-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        const outer = c.parent as EffectContext<EffectTrigger>
        if (outer.parent instanceof DamageContext) event = outer.parent
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-support') a.activePet.marks = a.activePet.marks.filter(m => m !== support)
        if (variant === 'late-hp') victim.activePet.currentHp = 47
        if (variant === 'late-maxhp') a.activePet.attributeSystem.updateBaseValue('maxHp', 1001)
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-slot') b.activePet = b.team[1]
      },
    }),
  )
  const trigger = originals.get(id)!.trigger as EffectTrigger
  if (variant === 'phase' || variant === 'skill-source-phase' || variant === 'effect-phase') {
    const phase = new DamagePhase(
      battle,
      use,
      variant === 'skill-source-phase' ? actor.activePet.skills[0] : actor.activePet,
      target,
      baseDamage,
      variant === 'effect-phase' ? DamageType.Effect : DamageType.Physical,
      false,
      1,
      false,
      1,
      [0, 0],
      10,
      5000,
    )
    phase.initialize()
    phase.execute()
    event = phase.context as DamageContext
  } else {
    const parent = variant === 'nested' ? new EffectContext(event, EffectTrigger.BeforeEffect, source) : event
    battle.applyEffects<EffectTrigger>(parent, trigger, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, trigger, source)
  }
  const beforeUpdate = event.damageResult
  if (variant === 'lower-last') event.addThreshold(7)
  if (variant === 'upper-last') event.addThreshold(undefined, 5)
  // Recalculation is explicit, never performed by the threshold operator.
  const hp = target.currentHp
  event.updateDamageResult()
  return {
    admitted,
    min: event.minThreshold,
    max: event.maxThreshold,
    beforeUpdate,
    result: event.damageResult,
    hp,
    next: battle.random(),
  }
}
for (const id of ids)
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const actual = run(true, id, markSource, variant)
        expect(actual).toEqual(run(false, id, markSource, variant))
        const cap = id === 'effect_mark_damage_cap_half_max_hp',
          save = id === 'effect_skill_save_hp_to_1',
          support = id === 'effect_skill_minimum_damage_100_if_aideminyi'
        if (variant === 'normal') {
          expect(actual.admitted).toBe(1)
          expect(actual.beforeUpdate).toBe(123)
          expect(actual.min).toBe(cap || save ? 10 : id === 'effect_skill_min_damage_95' ? 95 : 100)
          expect(actual.max).toBe(cap ? 1000 : save ? 1499 : 5000)
        }
        if (variant === 'cancel') {
          expect(actual.admitted).toBe(1)
          expect([actual.min, actual.max]).toEqual([10, 5000])
        }
        if (variant === 'missing-support' && support) expect(actual.admitted).toBe(0)
        if (variant === 'wrong-owner') expect(actual.admitted).toBe(0)
        if (variant === 'late-support') expect(actual.admitted).toBe(1)
        if (cap && variant === 'late-maxhp') expect(actual.max).toBe(500)
        if (cap && variant === 'late-owner') expect(actual.max).toBe(500)
        if (save && variant === 'late-hp') expect(actual.max).toBe(46)
        if (save && variant === 'late-slot') expect(actual.max).toBe(699)
        if (variant === 'lower-last') expect(actual.min).toBe(7)
        if (variant === 'upper-last') {
          expect(actual.max).toBe(5)
          expect(actual.result).toBe(5)
        }
        if (variant === 'phase' || variant === 'skill-source-phase' || (variant === 'effect-phase' && save)) {
          expect(actual.admitted).toBe(1)
          if (save) {
            expect(actual.hp).toBe(0)
            expect(actual.beforeUpdate).toBe(2000)
            expect(actual.max).toBe(-1)
          } else {
            const amount = cap ? 1000 : id === 'effect_skill_min_damage_95' ? 95 : 100
            expect(actual.beforeUpdate).toBe(amount)
            expect(actual.hp).toBe(1500 - amount)
          }
        }
        if (variant === 'effect-phase' && !save) {
          expect(actual.admitted).toBe(0)
          expect([actual.min, actual.max]).toEqual([10, 5000])
        }
      })
it('pins all five hashes and literal-zero omission', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/damage-thresholds-candidates.json', import.meta.url), 'utf8'),
  )
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
          )
        : v
  expect(ids).toHaveLength(5)
  expect(ledger.records.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort())
  expect(ledger.rejected).toEqual([])
  for (const r of ledger.records) {
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(originals.get(r.id))))
        .digest('hex'),
    )
    expect(r.recipe.actions[0].sourcePath).toBe('/apply')
    expect(r.recipe.repairedPaths).toEqual([])
  }
  expect(
    ledger.records.find((r: { id: string }) => r.id === 'effect_mark_damage_cap_half_max_hp').recipe.actions[0].code,
  ).not.toContain('min:')
})

for (const variant of [
  'both',
  'missing-min',
  'missing-max',
  'both-missing',
  'zero',
  'negative-max',
  'nonfinite',
  'foreign',
  'foreign-after-read',
  'snapshot',
] as const)
  it(`threshold inputs and ownership: ${variant}`, () => {
    const { battle, a, b } = makeScenario(1502)
    battles.push(battle)
    const other = makeScenario(1503)
    battles.push(other.battle)
    const parent = new TurnContext(battle),
      source = a.activePet.skills[0]
    const selected = [
      new DamageContext(
        new EffectContext(parent, EffectTrigger.TurnEnd, source),
        a.activePet,
        b.activePet,
        80,
        DamageType.Effect,
      ),
      new DamageContext(
        new EffectContext(parent, EffectTrigger.TurnEnd, source),
        a.activePet,
        b.activePet,
        80,
        DamageType.Effect,
      ),
    ]
    for (const event of selected) {
      event.minThreshold = 10
      event.maxThreshold = 200
      event.damageResult = 17
    }
    if (variant === 'foreign') Object.defineProperty(selected[1], 'battle', { value: other.battle })
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    const order: string[] = []
    const min = selectFrom(['min'])
      .select(() => {
        order.push('min')
        if (variant === 'foreign-after-read') Object.defineProperty(selected[0], 'battle', { value: other.battle })
        return variant === 'nonfinite' ? Infinity : variant === 'zero' ? 0 : 95
      })
      .where(() => !['missing-min', 'both-missing'].includes(variant))
      .first()
    const max = selectFrom(['max'])
      .select(() => {
        order.push('max')
        return variant === 'negative-max' ? -1 : 100
      })
      .where(() => !['missing-max', 'both-missing'].includes(variant))
      .first()
    const options = { min, max },
      operation = ops.setDamageThreshold(options)
    if (variant === 'snapshot') options.min = selectFrom([999]).first()
    const effect = compileEffect(
      defineEffect({ id: 'fixture/threshold-input', on: 'TurnEnd', execute: selectFrom(selected).apply(operation) }),
    )
    const ctx = new EffectContext(parent, EffectTrigger.TurnEnd, source, effect)
    const apply = () => battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(ctx))
    const rejected = ['nonfinite', 'foreign', 'foreign-after-read'].includes(variant)
    if (rejected)
      expect(apply).toThrow(variant === 'nonfinite' ? 'Expected finite numeric input' : 'Cross-battle damage context')
    else apply()
    expect(order).toEqual(variant === 'foreign' ? [] : ['min', 'max'])
    for (const event of selected) {
      expect(event.damageResult).toBe(17)
      expect(event.minThreshold).toBe(
        rejected || ['missing-min', 'both-missing'].includes(variant) ? 10 : variant === 'zero' ? 0 : 95,
      )
      expect(event.maxThreshold).toBe(
        rejected || ['missing-max', 'both-missing'].includes(variant) ? 200 : variant === 'negative-max' ? -1 : 100,
      )
    }
  })
