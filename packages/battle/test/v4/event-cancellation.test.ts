import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedEventCancellation,
  effectAuthoring,
  BaseMark,
  BaseStatLevelMark,
  StatTypeWithoutHp,
  AddMarkContext,
  DamageContext,
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
type Id = keyof typeof generatedEventCancellation
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/event-cancellation-candidates.json', import.meta.url), 'utf8'),
)
const ids = Object.keys(generatedEventCancellation) as Id[]
const corrections: Partial<Record<Id, [number, string, string]>> = {
  effect_ability_shenguang_immune_status_above_half_hp: [1, 'baseMarkId', 'baseMark'],
  effect_ability_immune_exceptional_if_rage_gt_50: [2, 'baseMarkId', 'baseMark'],
  effect_emblem_immune_mark_zhixi: [1, 'baseMarkId', 'baseMark.id'],
  effect_emblem_immune_mark_haipa: [1, 'baseMarkId', 'baseMark.id'],
  effect_emblem_anying_immune_fear_early_wake: [1, 'effectId', 'effect.id'],
  effect_mark_immune_status: [1, 'baseMarkId', 'baseMark'],
  effect_mark_immune_exceptional: [1, 'baseMarkId', 'baseMark'],
  effect_mark_immune_zhongdu: [1, 'baseMarkId', 'baseMark.id'],
}
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
const definitions = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ]
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    const correction = corrections[id]
    if (correction) {
      const [index, before, after] = correction
      expect(() => EffectParser.parse(d)).toThrow()
      expect(r.recipe.pathRepairs).toEqual([
        { path: `/condition/conditions/${index}/target/chain/0/arg`, before, after },
      ])
      expect(d.condition.conditions[index].target.chain[0].arg).toBe(before)
      d.condition.conditions[index].target.chain[0].arg = after
    } else expect(r.recipe.pathRepairs).toBeUndefined()
    return [id, d]
  }),
)
const oracles = new Map(ids.map(id => [id, EffectParser.parse(definitions.get(id))]))
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
  'nested',
  'real',
  'late-base',
  'repeat',
  'threshold',
  'below',
  'second-tag',
  'empty-tags',
] as const
function runMark(id: Id, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(2301)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const skill = a.activePet.skills[0],
    d = definitions.get(id)!
  const marker = new BaseMark('fixture/cancel' as baseMarkId, [], { ...debuff.config, duration: -1 }).createInstance()
  marker.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(marker)
  const source = kind === 'mark' ? marker : skill
  source.effects.push(native ? generatedEventCancellation[id] : oracles.get(id)!)
  a.currentRage = variant === 'threshold' ? 50 : variant === 'below' ? 49 : 51
  a.activePet.currentHp =
    Math.floor(a.activePet.stat.maxHp / 2) + (variant === 'threshold' ? 0 : variant === 'below' ? -1 : 1)
  const match = d.condition.conditions.find((c: { evaluator?: { type: string } }) => c.evaluator?.type === 'same')
  const base =
    id === 'effect_mark_immune_stage_debuff' && variant !== 'wrong-base'
      ? new BaseStatLevelMark(StatTypeWithoutHp.spd, -1, 'fixture/down' as baseMarkId)
      : new BaseMark(
          (variant === 'wrong-base' ? 'fixture/wrong' : (match?.evaluator.value ?? 'fixture/status')) as baseMarkId,
          [],
          debuff.config,
          variant === 'wrong-base' || variant === 'empty-tags'
            ? []
            : [...(variant === 'second-tag' ? ['other'] : []), id.includes('exceptional') ? 'exceptional' : 'status'],
        )
  const parent = new EffectContext(
    new TurnContext(battle),
    EffectTrigger.TurnStart,
    variant === 'wrong-applicant' ? b.activePet.skills[0] : skill,
  )
  const event = new AddMarkContext(parent, variant === 'wrong-target' ? b.activePet : a.activePet, base)
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/cancel-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply() {
        admitted++
        if (variant === 'late-base') event.baseMark = debuff
      },
    }),
  )
  if (variant === 'real') battle.addMark(event)
  else {
    const ctx = variant === 'nested' ? new EffectContext(event, EffectTrigger.OnBeforeAddMark, source) : event
    battle.applyEffects<EffectTrigger>(ctx, EffectTrigger.OnBeforeAddMark, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(ctx, EffectTrigger.OnBeforeAddMark, source)
  }
  return { admitted, available: event.available, added: event.target.marks.some(m => m.base === base) }
}
for (const id of ids.filter(id => definitions.get(id).trigger === 'OnBeforeAddMark'))
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id}/${kind}/${variant}`, () =>
        expect(runMark(id, true, kind, variant)).toEqual(runMark(id, false, kind, variant)))
for (const id of ids.filter(id => definitions.get(id).trigger === 'OnBeforeAddMark')) {
  it(`cancels actual creation ${id}`, () =>
    expect(runMark(id, true, 'mark', 'real')).toEqual({ admitted: 1, available: false, added: false }))
  it(`does not recheck admission after base changes ${id}`, () =>
    expect(runMark(id, true, 'skill', 'late-base').available).toBe(false))
}
function runEffect(id: Id, native: boolean, variant: string) {
  const { battle, a, b } = makeScenario(2302)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const source = a.activePet.skills[0]
  source.effects.push(native ? generatedEventCancellation[id] : oracles.get(id)!)
  const anying = id.includes('anying')
  const actor = variant === 'wrong-owner' ? b.activePet.skills[0] : source
  let executed = 0
  const target = defineNativeEffect({
    id: (variant === 'wrong-id' ? 'fixture/other' : 'effect_mark_onDamage_over100_recovery') as effectId,
    triggers: [EffectTrigger.OnDamage],
    tags: variant === 'wrong-tag' ? [] : variant === 'second-tag' ? ['other', 'xingzhili'] : ['xingzhili'],
    apply() {
      executed++
    },
  })
  actor.effects.push(target)
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source)
  const damaged =
    variant === 'same-player-bench'
      ? a.team[1]
      : variant === 'opponent-bench'
        ? b.team[1]
        : variant === 'wrong-target'
          ? a.activePet
          : b.activePet
  const damage = new DamageContext(parent, source, damaged, 20)
  const outer = new EffectContext(damage, EffectTrigger.OnDamage, actor, variant === 'no-effect' ? undefined : target)
  if (variant === 'real') battle.applyEffects(damage, EffectTrigger.OnDamage, actor)
  else battle.applyEffects(outer, EffectTrigger.BeforeEffect, source)
  return { available: outer.available, executed, anying }
}
for (const id of ids.filter(id => definitions.get(id).trigger === 'BeforeEffect'))
  for (const variant of [
    'normal',
    'wrong-owner',
    'wrong-id',
    'wrong-tag',
    'second-tag',
    'wrong-target',
    'same-player-bench',
    'opponent-bench',
    'no-effect',
    'real',
  ])
    it(`${id}/${variant}`, () => expect(runEffect(id, true, variant)).toEqual(runEffect(id, false, variant)))
for (const id of ids.filter(id => definitions.get(id).trigger === 'BeforeEffect')) {
  it(`cancels outer effect ${id}`, () => expect(runEffect(id, true, 'normal').available).toBe(false))
  it(`suppresses actual effect execution ${id}`, () => expect(runEffect(id, true, 'real').executed).toBe(0))
}
it('nearest effect excludes the currently executing authoring effect and rejects foreign writes', () => {
  const { battle, a } = makeScenario(2303),
    foreign = makeScenario(2304)
  battles.push(battle, foreign.battle)
  const source = a.activePet.skills[0],
    turn = new TurnContext(battle)
  const outer = new EffectContext(turn, EffectTrigger.TurnStart, source)
  const other = new EffectContext(
    new TurnContext(foreign.battle),
    EffectTrigger.TurnStart,
    foreign.a.activePet.skills[0],
  )
  const { compileEffect, defineEffect, contexts, ops, selectFrom } = effectAuthoring
  const local = compileEffect(
    defineEffect({
      id: 'fixture/context-query',
      on: 'BeforeEffect',
      execute(ctx) {
        expect(ctx.read(contexts.effect.first())).toBe(outer)
        expect(() => selectFrom([outer, other]).apply(ops.disableContext())(ctx)).toThrow('Cross-battle')
        expect(outer.available).toBe(true)
        contexts.effect.apply(ops.disableContext())(ctx)
      },
    }),
  )
  battle.executionBudget.run(battle.currentTurn, () =>
    local.innerApply(new EffectContext(outer, EffectTrigger.BeforeEffect, source, local)),
  )
  expect(outer.available).toBe(false)
})

it('revalidates context ownership after each cancellation write', () => {
  const { battle, a } = makeScenario(2305),
    foreign = makeScenario(2306)
  battles.push(battle, foreign.battle)
  const source = a.activePet.skills[0],
    turn = new TurnContext(battle)
  const first = new EffectContext(turn, EffectTrigger.TurnStart, source)
  const second = new EffectContext(turn, EffectTrigger.TurnStart, source)
  let available = true
  Object.defineProperty(first, 'available', {
    get: () => available,
    set: (value: boolean) => {
      available = value
      Object.defineProperty(second, 'battle', { value: foreign.battle })
    },
  })
  const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/revalidate',
      on: 'BeforeEffect',
      execute: selectFrom([first, second]).apply(ops.disableContext()),
    }),
  )
  expect(() =>
    battle.executionBudget.run(battle.currentTurn, () =>
      effect.innerApply(new EffectContext(first, EffectTrigger.BeforeEffect, source, effect)),
    ),
  ).toThrow('Cross-battle')
  expect(first.available).toBe(false)
  expect(second.available).toBe(true)
})
for (const id of [
  'effect_ability_shenguang_immune_status_above_half_hp',
  'effect_ability_immune_exceptional_if_rage_gt_50',
] as const)
  for (const variant of ['threshold', 'below'] as const)
    it(`strict threshold ${id}/${variant}`, () => expect(runMark(id, true, 'mark', variant).available).toBe(true))
