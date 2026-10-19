import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedVitalSequences,
  effectAuthoring,
  parameterAddress,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  StackContext,
  AddMarkContext,
  StackStrategy,
  DamageContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const id = 'effect_mark_explode_on_stack_over_100'
const original = parse(readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'), {
  merge: true,
}).find((d: { id: string }) => d.id === id)
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
  'below',
  'threshold',
  'wrong-owner',
  'other-mark',
  'late-event',
  'late-stack',
  'late-owner',
  'cancel',
  'nested',
  'repeat',
  'phase',
  'phase-below',
  'damage-param',
  'consume-param',
  'damage-zero',
  'consume-zero',
  'between-param',
  'between-stack',
  'between-owner',
  'between-detach',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(1001)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1000
  }
  const base = new BaseMark('fixture/explosion' as baseMarkId, [], {
    ...debuff.config,
    duration: -1,
    maxStacks: 1000,
    stackStrategy: StackStrategy.stack,
  })
  const mark = base.createInstance()
  mark.owner = a.activePet
  mark.stack = variant === 'threshold' ? 100 : 150
  a.activePet.marks.push(mark)
  const source = kind === 'mark' ? mark : a.activePet.skills[0]
  const effect = native ? generatedVitalSequences[id] : oracle
  source.effects.push(effect)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  const key = (damage: boolean) =>
    native
      ? parameterAddress(id, 'parameters', damage ? 'action0_value' : 'action1_value')
      : `${id}.${damage ? 'yinbo_damage_value' : 'yinbo_consume_stacks_value'}`
  if (variant === 'damage-param') battle.configSystem.set(key(true), 37)
  if (variant === 'consume-param') battle.configSystem.set(key(false), 30)
  if (variant === 'damage-zero') battle.configSystem.set(key(true), 0)
  if (variant === 'consume-zero') battle.configSystem.set(key(false), 0)
  const parent = new EffectContext<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  const add = new AddMarkContext(parent, a.activePet, base, 10)
  const incoming = base.createInstance()
  incoming.stack = 10
  const existing = variant === 'other-mark' ? base.createInstance() : mark
  if (variant === 'other-mark') existing.owner = a.activePet
  if (variant === 'wrong-owner') existing.owner = b.activePet
  const stack = new StackContext(
    add,
    existing,
    incoming,
    90,
    -1,
    variant === 'below' ? 99 : variant === 'threshold' ? 100 : 150,
    -1,
    StackStrategy.stack,
  )
  let admitted = 0
  const damageTrace: { amount: number; target: number; stack: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/explosion-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'cancel') (c.parent as EffectContext<EffectTrigger>).available = false
        if (variant === 'late-event') stack.stacksAfter = 0
        if (variant === 'late-stack') mark.stack = 20
        if (variant === 'late-owner') source.owner = a.team[1]
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/explosion-damage' as effectId,
      triggers: [EffectTrigger.OnDamage],
      when: c =>
        c.parent instanceof DamageContext &&
        c.parent.parent instanceof EffectContext &&
        c.parent.parent.effect?.id === id,
      apply(c) {
        const event = c.parent as DamageContext
        damageTrace.push({ amount: event.damageResult, target: a.team.indexOf(event.target), stack: mark.stack })
        if (variant === 'between-param') battle.configSystem.set(key(false), 30)
        if (variant === 'between-stack') mark.stack = 200
        if (variant === 'between-owner') source.owner = a.team[1]
        if (variant === 'between-detach') source.owner = null
      },
    }),
  )
  if (variant === 'phase' || variant === 'phase-below') {
    mark.stack = variant === 'phase' ? 95 : 80
    a.activePet.addMark(new AddMarkContext(parent, a.activePet, base, 10))
  } else {
    const event = variant === 'nested' ? new EffectContext(stack, EffectTrigger.BeforeEffect, source) : stack
    battle.applyEffects<EffectTrigger>(event, EffectTrigger.OnStack, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(event, EffectTrigger.OnStack, source)
  }
  return {
    admitted,
    damageTrace,
    hp: a.team.map(p => p.currentHp),
    stack: mark.stack,
    active: mark.isActive,
    owner: mark.owner ? a.team.indexOf(mark.owner as typeof a.activePet) : -1,
    next: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  for (const variant of variants)
    it(`stack explosion ${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      const rejected =
        variant === 'below' || variant === 'phase-below' || (variant === 'wrong-owner' && kind === 'skill')
      if (rejected) {
        expect(actual.admitted).toBe(0)
        expect(actual.damageTrace).toEqual([])
        return
      }
      expect(actual.admitted).toBe(variant === 'repeat' ? 2 : 1)
      if (variant === 'cancel') {
        expect(actual.damageTrace).toEqual([])
        expect(actual.stack).toBe(150)
        return
      }
      expect(actual.damageTrace[0].amount).toBe(variant === 'damage-param' ? 37 : variant === 'damage-zero' ? 0 : 100)
      if (variant === 'normal' || variant === 'phase') expect(actual.hp[0]).toBe(900)
      if (variant === 'late-owner') expect(actual.damageTrace[0].target).toBe(1)
      if (variant === 'late-stack') expect(actual.damageTrace[0].stack).toBe(20)
      if (variant === 'phase') expect(actual.damageTrace[0].stack).toBe(105)
      if (kind === 'skill') {
        expect(actual.stack).toBe(
          variant === 'between-stack'
            ? 200
            : variant === 'late-stack'
              ? 20
              : variant === 'threshold'
                ? 100
                : variant === 'phase'
                  ? 105
                  : 150,
        )
        return
      }
      if (variant === 'between-detach') expect(actual.stack).toBe(50)
      if (variant === 'normal' || variant === 'late-event' || variant === 'other-mark') expect(actual.stack).toBe(50)
      if (variant === 'consume-param' || variant === 'between-param') expect(actual.stack).toBe(120)
      if (variant === 'consume-zero') expect(actual.stack).toBe(150)
      if (variant === 'between-stack') expect(actual.stack).toBe(100)
      if (variant === 'threshold' || variant === 'late-stack' || variant === 'repeat') {
        expect(actual.stack).toBe(0)
        expect(actual.active).toBe(false)
      }
      if (variant === 'phase') expect(actual.stack).toBe(5)
    })
it('pins source, parameter aliases and full order', () => {
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
  expect(record.recipe.parameters).toEqual([
    { name: 'action0_value', value: 100, configId: 'yinbo_damage_value' },
    { name: 'action1_value', value: 100, configId: 'yinbo_consume_stacks_value' },
  ])
  expect(record.recipe.repairedPaths).toEqual([])
})
