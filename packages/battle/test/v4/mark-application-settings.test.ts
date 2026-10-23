import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  BaseStatLevelMark,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedMarkApplicationSettings } from '@arcadia-eternity/data-pack-base/native'

type Id = keyof typeof generatedMarkApplicationSettings
const ids = Object.keys(generatedMarkApplicationSettings) as Id[]
const ledger = JSON.parse(
  readFileSync(
    new URL('../../../../docs/v4/validation/mark-application-settings-candidates.json', import.meta.url),
    'utf8',
  ),
)
const definitions = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    return [
      id,
      parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
        Number(r.sourcePath.slice(1))
      ],
    ]
  }),
)
const oracles = new Map(
  ids.map(id => {
    const d = structuredClone(definitions.get(id))
    if (id !== 'effect_emblem_xuruo_10percent_extra_debuff_stack') {
      expect(d.condition.conditions[1].target.chain[0].arg).toBe('baseMarkId')
      d.condition.conditions[1].target.chain[0].arg = 'baseMark.id'
    }
    return [id, EffectParser.parse(d)]
  }),
)
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
  'wrong-target',
  'wrong-applicant',
  'wrong-base',
  'late-value',
  'late-base',
  'late-owner',
  'cancel',
  'nested',
  'repeat',
  'real',
  'real-stack',
] as const
function run(
  id: Id,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  options: {
    duration?: number
    stack?: number
    sourceStack?: number
    roll?: number
    stat?: StatTypeWithoutHp
    level?: number
    markId?: string
  } = {},
) {
  const { battle, a, b, debuff } = makeScenario(1701)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const skill = a.activePet.skills[0],
    d = definitions.get(id)!
  const sourceMark = new BaseMark('fixture/settings' as baseMarkId, [], {
    ...debuff.config,
    duration: -1,
    maxStacks: 10,
    persistent: true,
  }).createInstance()
  sourceMark.setOwner(a.activePet, battle.emitter)
  sourceMark.stack = options.sourceStack ?? 3
  a.activePet.marks.push(sourceMark)
  const source = kind === 'mark' ? sourceMark : skill
  source.effects.push(native ? generatedMarkApplicationSettings[id] : oracles.get(id)!)
  const stage = id === 'effect_emblem_xuruo_10percent_extra_debuff_stack'
  const predicate = d.condition.conditions[1].evaluator
  const markId =
    options.markId ?? (stage ? 'fixture/stat' : predicate.value instanceof Array ? predicate.value[0] : predicate.value)
  const base =
    stage && variant !== 'wrong-base'
      ? new BaseStatLevelMark(options.stat ?? StatTypeWithoutHp.spd, options.level ?? -1, markId as baseMarkId)
      : new BaseMark((variant === 'wrong-base' ? 'fixture/wrong' : markId) as baseMarkId, [], {
          ...debuff.config,
          maxStacks: 10,
          duration: 5,
          stackable: true,
        })
  const applicant = variant === 'wrong-applicant' ? b.activePet.skills[0] : skill
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, applicant)
  const event = new AddMarkContext(
    parent,
    variant === 'wrong-target' ? b.activePet : a.activePet,
    base,
    options.stack ?? 2,
    options.duration ?? 3,
  )
  let admitted = 0,
    draws = 0
  const random = battle.random.bind(battle)
  battle.random = () => {
    draws++
    return options.roll ?? 0.05
  }
  const trace: string[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/settings-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnMarkCreated, EffectTrigger.OnStack],
      when: c =>
        c.trigger !== EffectTrigger.BeforeEffect || (c.parent instanceof EffectContext && c.parent.effect?.id === id),
      apply(c) {
        if (c.trigger !== EffectTrigger.BeforeEffect) {
          trace.push(c.trigger)
          return
        }
        admitted++
        if (variant === 'late-value') {
          event.duration = 7
          event.stack = 4
        }
        if (variant === 'late-base') event.baseMark = debuff
        if (variant === 'late-owner') source.setOwner(a.team[1], battle.emitter)
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  if (variant === 'real-stack') {
    const existing = base.createInstance()
    existing.setOwner(a.activePet, battle.emitter)
    if (existing instanceof StatLevelMarkInstanceImpl) existing.level = -1
    else existing.stack = 1
    existing.duration = 1
    a.activePet.marks.push(existing)
  }
  if (variant === 'real' || variant === 'real-stack') battle.addMark(event)
  else {
    const ctx = variant === 'nested' ? new EffectContext(event, EffectTrigger.BeforeEffect, source) : event
    battle.applyEffects<EffectTrigger>(ctx, EffectTrigger.OnBeforeAddMark, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(ctx, EffectTrigger.OnBeforeAddMark, source)
  }
  return {
    admitted,
    duration: event.duration,
    stack: event.stack,
    maxStacks: event.config?.maxStacks,
    sourceStack: sourceMark.stack,
    sourceActive: sourceMark.isActive,
    baseDuration: base.config.duration,
    baseMax: base.config.maxStacks,
    trace,
    draws,
    next: random(),
    marks: event.target.marks
      .filter(m => m !== sourceMark)
      .map(m => ({
        base: m.baseId,
        duration: m.duration,
        stack: m.stack,
        maxStacks: m.config.maxStacks,
        level: m instanceof StatLevelMarkInstanceImpl ? m.level : undefined,
      })),
  }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id}/${kind}/${variant}`, () => expect(run(id, true, kind, variant)).toEqual(run(id, false, kind, variant)))
for (const id of ids)
  for (const native of [false, true])
    it(`independent assignment ${id}/${native}`, () => {
      const d = definitions.get(id),
        r = run(id, native, 'mark', 'normal')
      expect(r.admitted).toBe(1)
      const amount =
        typeof d.apply.value === 'number'
          ? d.apply.value
          : id === 'effect_emblem_xuruo_10percent_extra_debuff_stack'
            ? 3
            : id === 'effect_mark_double_mark_yanhuo_duration'
              ? 6
              : 4
      expect(
        r[d.apply.type === 'setMarkDuration' ? 'duration' : d.apply.type === 'setMarkStack' ? 'stack' : 'maxStacks'],
      ).toBe(amount)
      if (d.apply.type === 'setMarkMaxStack') {
        expect(r.stack).toBe(2)
        expect(r.baseMax).toBe(10)
      }
      if (d.apply.type === 'setMarkDuration') expect(r.baseDuration).toBe(5)
    })
for (const id of ids.filter(id => definitions.get(id).apply.value.type === 'dynamic'))
  for (const duration of [-1, 0, 0.5, 7])
    it(`late dynamic input ${id}/${duration}`, () => {
      const actual = run(id, true, 'mark', 'late-value', { duration, stack: duration })
      expect(actual).toEqual(run(id, false, 'mark', 'late-value', { duration, stack: duration }))
      expect(id === 'effect_emblem_xuruo_10percent_extra_debuff_stack' ? actual.stack : actual.duration).toBe(
        id === 'effect_emblem_xuruo_10percent_extra_debuff_stack'
          ? 5
          : id === 'effect_mark_double_mark_yanhuo_duration'
            ? 14
            : 8,
      )
    })
for (const stat of [
  StatTypeWithoutHp.atk,
  StatTypeWithoutHp.def,
  StatTypeWithoutHp.spa,
  StatTypeWithoutHp.spd,
  StatTypeWithoutHp.spe,
])
  for (const level of [-2, 0, 2])
    for (const roll of [0.09999, 0.1])
      it(`stage identity and probability ${stat}/${level}/${roll}`, () => {
        const id = 'effect_emblem_xuruo_10percent_extra_debuff_stack',
          options = { stat, level, roll, stack: 5 }
        const r = run(id, true, 'mark', 'normal', options)
        expect(r).toEqual(run(id, false, 'mark', 'normal', options))
        expect(r.admitted).toBe(Number(level < 0 && roll < 0.1))
        expect(r.stack).toBe(level < 0 && roll < 0.1 ? 6 : 5)
        expect(r.draws).toBe(level < 0 ? 1 : 0)
      })
it('last source stack still updates the pending mark duration', () => {
  const id = 'effect_mark_double_mark_yanhuo_duration',
    r = run(id, true, 'mark', 'real', { sourceStack: 1 })
  expect(r).toEqual(run(id, false, 'mark', 'real', { sourceStack: 1 }))
  expect(r.sourceStack).toBe(0)
  expect(r.sourceActive).toBe(false)
  expect(r.marks[0]?.duration).toBe(6)
})
for (const markId of ['mark_zhaocai', 'mark_jinbao', 'fixture/wrong'])
  it(`exact anyOf identity ${markId}`, () => {
    const id = 'effect_emblem_yaoling_extend_zhaocai_jinbao_duration',
      r = run(id, true, 'skill', 'normal', { markId })
    expect(r).toEqual(run(id, false, 'skill', 'normal', { markId }))
    expect(r.admitted).toBe(Number(markId !== 'fixture/wrong'))
  })
it('pins source hashes and explicit mark ID repairs', () => {
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
  expect(ids).toHaveLength(17)
  expect(ledger.rejected).toEqual([])
  for (const id of ids) {
    const d = definitions.get(id),
      r = ledger.records.find((r: { id: string }) => r.id === id)
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.classification).toBe('U')
    expect(r.recipe.repairedPaths).toEqual([])
    if (id === 'effect_emblem_xuruo_10percent_extra_debuff_stack') expect(r.additionalDecisions).toBeUndefined()
    else {
      expect(() => EffectParser.parse(d)).toThrow()
      expect(r.additionalDecisions).toEqual(['C09'])
      expect(r.recipe.pathRepairs).toEqual([
        { path: '/condition/conditions/1/target/chain/0/arg', before: 'baseMarkId', after: 'baseMark.id' },
      ])
    }
  }
})
for (const operation of ['setMarkDuration', 'setMarkStack', 'setMarkMaxStack'] as const)
  for (const numbers of [[], [2, 7], [-1], [0.5]])
    it(`cyclic distribution reads once ${operation}/${numbers}`, () => {
      const { battle, a, debuff } = makeScenario(1702)
      battles.push(battle)
      const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
      const events = [0, 1, 2].map(() => new AddMarkContext(parent, a.activePet, debuff, 3, 5))
      const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
      let reads = 0
      const input = selectFrom(numbers)
        .all()
        .map(values => {
          reads++
          return values
        })
      const effect = compileEffect(
        defineEffect({
          id: 'fixture/settings-read',
          on: 'OnBeforeAddMark',
          execute: selectFrom(events).apply(ops[operation](input)),
        }),
      )
      const ctx = new EffectContext(events[0], EffectTrigger.OnBeforeAddMark, a.activePet.skills[0], effect)
      battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(ctx))
      expect(reads).toBe(1)
      const expected = events.map(() => new AddMarkContext(parent, a.activePet, debuff, 3, 5))
      Operators[operation](numbers)(ctx, expected)
      expect(events.map(e => [e.duration, e.stack, e.config?.maxStacks])).toEqual(
        expected.map(e => [e.duration, e.stack, e.config?.maxStacks]),
      )
    })

for (const operation of ['setMarkDuration', 'setMarkStack', 'setMarkMaxStack'] as const)
  for (const variant of [
    'empty-targets',
    'absent',
    'foreign',
    'foreign-after-read',
    'foreign-after-write',
    'nonfinite',
  ] as const)
    it(`setter boundary ${operation}/${variant}`, () => {
      const { battle, a, debuff } = makeScenario(1703),
        other = makeScenario(1704)
      battles.push(battle, other.battle)
      const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
      const events = [0, 1].map(() => new AddMarkContext(parent, a.activePet, debuff, 3, 5))
      const field = operation === 'setMarkDuration' ? 'duration' : operation === 'setMarkStack' ? 'stack' : 'maxStacks'
      const actual = () => events.map(e => (field === 'maxStacks' ? e.config?.maxStacks : e[field]))
      const before = actual()
      if (variant === 'foreign') Object.defineProperty(events[1], 'battle', { value: other.battle })
      if (variant === 'foreign-after-write') {
        const method =
          operation === 'setMarkDuration' ? 'setDuration' : operation === 'setMarkStack' ? 'setStack' : 'setMaxStack'
        const original = events[0][method].bind(events[0])
        events[0][method] = n => {
          original(n)
          Object.defineProperty(events[1], 'battle', { value: other.battle })
        }
      }
      const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
      let reads = 0
      const input = selectFrom(variant === 'absent' ? [] : [2])
        .all()
        .map(values => {
          reads++
          if (variant === 'foreign-after-read') Object.defineProperty(events[0], 'battle', { value: other.battle })
          return variant === 'nonfinite' ? [Infinity] : values
        })
      const effect = compileEffect(
        defineEffect({
          id: 'fixture/settings-boundary',
          on: 'OnBeforeAddMark',
          execute: selectFrom(variant === 'empty-targets' ? [] : events).apply(ops[operation](input)),
        }),
      )
      const ctx = new EffectContext(events[0], EffectTrigger.OnBeforeAddMark, a.activePet.skills[0], effect)
      const apply = () => battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(ctx))
      if (variant === 'absent' || variant === 'empty-targets') apply()
      else
        expect(apply).toThrow(
          variant === 'nonfinite' ? 'Expected finite numeric input' : 'Cross-battle mark application context',
        )
      expect(reads).toBe(variant === 'foreign' ? 0 : 1)
      expect(actual()).toEqual(variant === 'foreign-after-write' ? [2, before[1]] : before)
    })
