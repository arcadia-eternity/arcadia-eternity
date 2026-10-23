import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamagePhase,
  DamageType,
  HealContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedVitalSequences } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_absorb_damage_to_heal'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'),
  {
    merge: true,
  },
).find((d: { id: string }) => d.id === id)
const oracle = EffectParser.parse(original)
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
  'between-seed',
  'between-value',
  'between-owner',
  'between-detach',
  'seed',
  'late-seed',
  'late-remove',
  'switch',
  'late-value',
  'cancel',
  'one-layer',
  'detach',
  'owner',
  'nested',
  'repeat',
  'phase',
  'phase-seed',
  'heal-cancel',
  'zero',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(901)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1000
  }
  const mark = new BaseMark('fixture/absorb-damage' as baseMarkId, [], {
    ...debuff.config,
    duration: -1,
    maxStacks: 10,
  }).createInstance()
  mark.owner = a.activePet
  mark.stack = variant === 'one-layer' ? 1 : 3
  a.activePet.marks.push(mark)
  const source = kind === 'mark' ? mark : a.activePet.skills[0]
  source.effects.push(native ? generatedVitalSequences[id] : oracle)
  const seed = new BaseMark('mark_kuihuazhongzi' as baseMarkId, [], { ...debuff.config, duration: -1 }).createInstance()
  seed.owner = b.activePet
  if (['seed', 'late-remove', 'switch', 'phase-seed'].includes(variant)) b.activePet.marks.push(seed)
  const use = new UseSkillContext(
    new TurnContext(battle),
    b,
    b.activePet,
    AttackTargetOpinion.opponent,
    b.activePet.skills[0],
  )
  use.updateActualTarget()
  let damage = new DamageContext(use, b.activePet, a.activePet, 101, DamageType.Special)
  damage.damageResult = variant === 'zero' ? 0 : 101
  let admitted = 0
  const heals: { value: number; available: boolean; hp: number; target: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/absorb-damage-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        const outer = c.parent as EffectContext<EffectTrigger>
        admitted++
        if (outer.parent instanceof DamageContext) damage = outer.parent
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-seed') b.activePet.marks.push(seed)
        if (variant === 'late-remove') b.activePet.marks.splice(b.activePet.marks.indexOf(seed), 1)
        if (variant === 'switch') b.activePet = b.team[1]
        if (variant === 'late-value') damage.damageResult = 47
        if (variant === 'detach') source.owner = null
        if (variant === 'owner') source.owner = a.team[1]
        if (variant.startsWith('between-')) {
          // Test seam after the first action's write, before the healing query.
          let available = damage.available
          Object.defineProperty(damage, 'available', {
            get: () => available,
            set(value: boolean) {
              available = value
              if (!value) {
                if (variant === 'between-seed') b.activePet.marks.push(seed)
                if (variant === 'between-value') damage.damageResult = 47
                if (variant === 'between-owner') source.owner = a.team[1]
                if (variant === 'between-detach') source.owner = null
              }
            },
            configurable: true,
          })
        }
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/absorb-damage-heal' as effectId,
      triggers: [EffectTrigger.OnBeforeHeal],
      when: c =>
        c.parent instanceof HealContext &&
        c.parent.parent instanceof EffectContext &&
        c.parent.parent.effect?.id === id,
      apply(c) {
        const event = c.parent as HealContext
        heals.push({
          value: event.baseHeal,
          available: damage.available,
          hp: event.target.currentHp,
          target: a.team.indexOf(event.target),
        })
        if (variant === 'heal-cancel') event.available = false
      },
    }),
  )
  if (variant === 'phase' || variant === 'phase-seed') {
    const phase = new DamagePhase(battle, use, b.activePet, a.activePet, 101, DamageType.Special)
    phase.initialize()
    phase.execute()
  } else {
    const parent = variant === 'nested' ? new EffectContext(damage, EffectTrigger.BeforeEffect, source) : damage
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger.OnDamage, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger.OnDamage, source)
  }
  return {
    admitted,
    heals,
    available: damage.available,
    hp: a.team.map(p => p.currentHp),
    stack: mark.stack,
    active: mark.isActive,
    next: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  for (const variant of variants)
    it(`damage absorption ${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      if (variant === 'nested') {
        expect(actual.admitted).toBe(0)
        expect(actual.heals).toEqual([])
        expect(actual.available).toBe(true)
        return
      }
      expect(actual.admitted).toBe(variant === 'repeat' ? 2 : 1)
      expect(actual.available).toBe(variant === 'cancel')
      if (
        variant === 'cancel' ||
        ['detach', 'between-detach'].includes(variant) ||
        (kind === 'mark' && variant === 'one-layer')
      ) {
        expect(actual.heals).toEqual([])
        return
      }
      const amount =
        variant === 'zero'
          ? 0
          : ['late-value', 'between-value'].includes(variant)
            ? 11
            : ['seed', 'late-seed', 'phase-seed', 'between-seed'].includes(variant)
              ? 50
              : 25
      expect(actual.heals[0]).toEqual({
        value: amount,
        available: false,
        hp: variant.startsWith('phase') ? 899 : 1000,
        target: ['owner', 'between-owner'].includes(variant) ? 1 : 0,
      })
      if (variant === 'phase' || variant === 'phase-seed') expect(actual.hp[0]).toBe(899 + amount)
      if (variant === 'heal-cancel') expect(actual.hp[0]).toBe(1000)
      if (variant === 'repeat') expect(actual.heals.map(h => h.value)).toEqual([25, 25])
    })

it('pins the complete uncorrected source and action order', async () => {
  const { createHash } = await import('node:crypto')
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/vital-sequences-candidates.json', import.meta.url), 'utf8'),
  )
  const record = ledger.records.find((r: { id: string }) => r.id === id)
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
  expect(record.definitionSha256).toBe(
    createHash('sha256')
      .update(JSON.stringify(normalize(original)))
      .digest('hex'),
  )
  expect(record.recipe.actions.map((a: { sourcePath: string }) => a.sourcePath)).toEqual(['/apply/0', '/apply/1'])
  expect(record.recipe.repairedPaths).toEqual([])
})
