import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedVitalSequences,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  DamageContext,
  HealContext,
  defineNativeEffect,
  executeTurnOperation,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const id = 'effect_mark_absorb_hp_to_opponent'
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const original = definitions.find((d: { id: string }) => d.id === id)
const oracle = EffectParser.parse(original)
const battles: Battle[] = []
const errors: unknown[][] = []
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
  'inactive',
  'cancel',
  'late-hp',
  'late-max',
  'late-owner',
  'detach',
  'damage-change-hp',
  'damage-change-max',
  'damage-change-owner',
  'damage-detach',
  'damage-switch',
  'repeat',
  'turn',
  'nested',
] as const
function run(
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  ownerHp = 800,
  ownerMax = 801,
) {
  const { battle, a, b, debuff } = makeScenario(701)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  a.team[0].attributeSystem.updateBaseValue('maxHp', ownerMax)
  a.team[0].currentHp = ownerHp
  a.team[1].attributeSystem.updateBaseValue('maxHp', 601)
  a.team[1].currentHp = 400
  for (const p of b.team) {
    p.attributeSystem.updateBaseValue('maxHp', 1601)
    p.currentHp = 100
  }
  const source =
    kind === 'skill'
      ? a.team[0].skills[0]
      : new BaseMark('fixture/absorb' as baseMarkId, [], {
          ...debuff.config,
          duration: -1,
          maxStacks: 3,
        }).createInstance()
  source.owner = a.team[0]
  if (kind === 'mark') a.team[0].marks.push(source as ReturnType<BaseMark['createInstance']>)
  source.effects.push(native ? generatedVitalSequences[id] : oracle)
  if (variant === 'inactive') a.activePet = a.team[1]
  const trace: { type: string; value: number; hp: number[]; target: number }[] = []
  const hp = () => [...a.team, ...b.team].map(p => p.currentHp)
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/absorb-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        const outer = c.parent as EffectContext<EffectTrigger>
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-hp') a.team[0].currentHp = 400
        if (variant === 'late-max') a.team[0].attributeSystem.updateBaseValue('maxHp', 401)
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'detach') source.owner = null
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/absorb-value' as effectId,
      triggers: [EffectTrigger.OnDamage, EffectTrigger.OnHeal],
      when: c =>
        (c.parent instanceof DamageContext || c.parent instanceof HealContext) &&
        c.parent.parent instanceof EffectContext &&
        c.parent.parent.effect?.id === id,
      apply(c) {
        const event = c.parent
        if (!(event instanceof DamageContext || event instanceof HealContext)) return
        trace.push({
          type: event instanceof DamageContext ? 'damage' : 'heal',
          value: event instanceof DamageContext ? event.damageResult : event.healResult,
          hp: hp(),
          target: [...a.team, ...b.team].indexOf(event.target),
        })
        if (!(event instanceof DamageContext)) return
        if (variant === 'damage-change-hp') a.team[0].currentHp = 400
        if (variant === 'damage-change-max') a.team[0].attributeSystem.updateBaseValue('maxHp', 401)
        if (variant === 'damage-change-owner') source.owner = b.team[0]
        if (variant === 'damage-detach') source.owner = null
        if (variant === 'damage-switch') b.activePet = b.team[1]
      },
    }),
  )
  const turn = new TurnContext(battle)
  if (variant === 'turn') {
    let reached = 0
    b.team[1].skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/absorb-turn-probe' as effectId,
        triggers: [EffectTrigger.TurnEnd],
        when: c => c.parent === turn,
        apply() {
          reached++
        },
      }),
    )
    a.selection = { player: a.id, type: 'do-nothing' }
    b.selection = { player: b.id, type: 'do-nothing' }
    executeTurnOperation(turn, battle)
    expect(reached).toBe(1)
  } else {
    const event = variant === 'nested' ? new EffectContext(turn, EffectTrigger.BeforeEffect, source) : turn
    battle.applyEffects<EffectTrigger>(event, EffectTrigger.TurnEnd, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(event, EffectTrigger.TurnEnd, source)
  }
  return { hp: hp(), trace, admitted, next: battle.random() }
}
for (const kind of ['skill', 'mark'] as const)
  for (const variant of variants)
    it(`absorb HP ${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      if (['inactive', 'cancel', 'detach'].includes(variant)) expect(actual.trace).toEqual([])
      else if (variant === 'damage-detach') expect(actual.trace.map(t => [t.type, t.value])).toEqual([['damage', 100]])
      else {
        const expected =
          variant === 'repeat'
            ? [100, 87, 87, 76]
            : variant === 'late-hp'
              ? [50, 43]
              : variant === 'late-max'
                ? [50, 50]
                : variant === 'late-owner'
                  ? [50, 43]
                  : variant === 'damage-change-hp'
                    ? [100, 50]
                    : variant === 'damage-change-max'
                      ? [100, 50]
                      : variant === 'damage-change-owner'
                        ? [100, 12]
                        : [100, 87]
        expect(actual.trace.map(t => t.value)).toEqual(expected)
        expect(actual.trace.map(t => t.type)).toEqual(
          variant === 'repeat' ? ['damage', 'heal', 'damage', 'heal'] : ['damage', 'heal'],
        )
        if (variant === 'normal' || variant === 'turn' || variant === 'nested')
          expect(actual.hp).toEqual([700, 400, 187, 100])
        if (variant === 'damage-switch') {
          expect(actual.trace[1].target).toBe(3)
          expect(actual.hp).toEqual([700, 400, 100, 187])
        }
        if (variant === 'damage-change-owner') {
          expect(actual.trace[1].target).toBe(0)
          expect(actual.hp).toEqual([712, 400, 100, 100])
        }
      }
    })
for (const [hp, max] of [
  [7, 801],
  [8, 801],
  [15, 801],
  [16, 801],
  [2000, 801],
  [800, 7],
  [1, 1],
] as const)
  it(`absorb HP floors and cap hp=${hp} max=${max}`, () => {
    const actual = run(true, 'mark', 'normal', hp, max)
    expect(actual).toEqual(run(false, 'mark', 'normal', hp, max))
    const damage = Math.min(Math.floor(hp / 8), Math.floor(max / 8))
    const heal = Math.min(Math.floor((hp - damage) / 8), Math.floor(max / 8))
    expect(actual.trace.map(t => [t.type, t.value])).toEqual([
      ['damage', damage],
      ['heal', heal],
    ])
    expect(actual.hp[0]).toBe(hp - damage)
    expect(actual.hp[2]).toBe(100 + heal)
  })
it('pins original source and ordered dynamic upper bounds', () => {
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
  expect(record.classification).toBe('U')
})
