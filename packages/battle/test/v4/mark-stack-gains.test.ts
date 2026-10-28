import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
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
  executeTurnOperation,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedMarkStackGains } from '@arcadia-eternity/data-pack-base/native'

const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
type Id = keyof typeof generatedMarkStackGains
const ids = Object.keys(generatedMarkStackGains) as Id[]
const originals = new Map(ids.map(id => [id, definitions.find((d: { id: string }) => d.id === id)]))
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
  'late-value',
  'late-stack',
  'late-cap',
  'late-owner',
  'late-detach',
  'wrong-target',
  'inactive-owner',
  'zero',
  'one',
  'odd',
  'at-cap',
  'above-cap',
  'nested',
  'repeat',
  'phase',
  'nonpet-phase',
  'overkill',
] as const
function run(native: boolean, id: Id, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(1401)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1500
  }
  const mark = new BaseMark('fixture/gain' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 100,
    persistent: true,
    duration: -1,
  }).createInstance()
  const owner = variant === 'inactive-owner' ? a.team[1] : a.activePet
  mark.setOwner(owner, battle.emitter)
  mark.stack = variant === 'at-cap' ? 100 : variant === 'above-cap' ? 120 : 3
  owner.marks.push(mark)
  mark.effects.push(native ? generatedMarkStackGains[id] : oracles.get(id)!)
  const events: string[] = []
  mark.effects.push(
    defineNativeEffect({
      id: 'fixture/stack-events' as effectId,
      triggers: [
        EffectTrigger.OnMarkCreated,
        EffectTrigger.OnStackBefore,
        EffectTrigger.OnStack,
        EffectTrigger.OnMarkDestroy,
      ],
      apply(c) {
        events.push(c.trigger)
      },
    }),
  )
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
  use.updateActualTarget()
  const damage = new DamageContext(
    use,
    b.activePet,
    variant === 'wrong-target' ? b.activePet : owner,
    101,
    DamageType.Effect,
  )
  damage.damageResult = variant === 'zero' ? 0 : variant === 'one' ? 1 : variant === 'odd' ? 3 : 101
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/gain-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        const outer = c.parent as EffectContext<EffectTrigger>
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-value') damage.damageResult = 47
        if (variant === 'late-stack') mark.stack = 11
        if (variant === 'late-cap') mark.config.maxStacks = 7
        if (variant === 'late-owner') mark.owner = a.team[1]
        if (variant === 'late-detach') mark.owner = null
      },
    }),
  )
  const trigger = originals.get(id)!.trigger as EffectTrigger
  if (['phase', 'nonpet-phase', 'overkill'].includes(variant)) {
    if (trigger === EffectTrigger.TurnEnd) {
      a.selection = { player: a.id, type: 'do-nothing' }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
    } else {
      if (variant === 'overkill') owner.currentHp = 7
      const source = variant === 'nonpet-phase' ? b.activePet.skills[0] : b.activePet
      const phase = new DamagePhase(battle, use, source, owner, 101, DamageType.Effect)
      phase.initialize()
      phase.execute()
    }
  } else {
    const parent = trigger === EffectTrigger.TurnEnd ? turn : damage
    const event = variant === 'nested' ? new EffectContext(parent, EffectTrigger.BeforeEffect, mark) : parent
    battle.applyEffects<EffectTrigger>(event, trigger, mark)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(event, trigger, mark)
  }
  return {
    admitted,
    stack: mark.stack,
    active: mark.isActive,
    owned: mark.owner !== null,
    events,
    hp: owner.currentHp,
    next: battle.random(),
  }
}
for (const id of ids)
  for (const variant of variants)
    it(`${id} ${variant}`, () => {
      const result = run(true, id, variant)
      expect(result).toEqual(run(false, id, variant))
      expect(result.events).toEqual([])
      const damage = id === 'effect_mark_stack_mark_with_damage'
      const denied = damage
        ? variant === 'wrong-target' || variant === 'zero' || variant === 'nested'
        : variant === 'inactive-owner'
      if (denied) {
        expect(result.admitted).toBe(0)
        expect(result.stack).toBe(3)
        return
      }
      expect(result.admitted).toBe(variant === 'repeat' ? 2 : 1)
      if (variant === 'cancel') {
        expect(result.stack).toBe(3)
        return
      }
      let amount = damage ? 50 : 1
      if (damage && variant === 'late-value') amount = 23
      if (damage && variant === 'one') amount = 0
      if (damage && variant === 'odd') amount = 1
      const initial = variant === 'at-cap' ? 100 : variant === 'above-cap' ? 120 : variant === 'late-stack' ? 11 : 3
      expect(result.stack).toBe(
        Math.min(variant === 'late-cap' ? 7 : 100, initial + amount * (variant === 'repeat' ? 2 : 1)),
      )
      if (variant === 'overkill' && damage) expect(result.hp).toBe(0)
    })
for (const amount of [0, -5, 0.5, 200])
  it(`direct addition preserves numeric semantics: ${amount}`, () => {
    const { battle, a, debuff } = makeScenario()
    battles.push(battle)
    const mark = new BaseMark('fixture/direct-gain' as baseMarkId, [], {
      ...debuff.config,
      maxStacks: 10,
    }).createInstance()
    mark.setOwner(a.activePet, battle.emitter)
    a.activePet.marks.push(mark)
    mark.stack = 3
    const ctx = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0])
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/direct-gain',
        triggers: [EffectTrigger.TurnEnd],
        apply: selectFrom([mark]).apply(ops.addStacks(amount)),
      }),
    )
    battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(ctx))
    const actual = mark.stack
    mark.stack = 3
    Operators.addStack(amount)(ctx, [mark])
    expect(actual).toBe(mark.stack)
    expect(actual).toBe(Math.max(0, Math.min(10, 3 + amount)))
    expect(mark.isActive).toBe(true)
  })
it('pins source hashes and exact direct addition operations', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/mark-stack-gains-candidates.json', import.meta.url), 'utf8'),
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
  expect(ids).toHaveLength(2)
  expect(ledger.records.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort())
  expect(ledger.rejected).toEqual([])
  for (const r of ledger.records) {
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(originals.get(r.id))))
        .digest('hex'),
    )
    expect(r.recipe.actions[0].sourcePath).toBe('/apply')
    expect(r.recipe.actions[0].code).toContain('ops.addStacks(')
    expect(r.recipe.repairedPaths).toEqual([])
  }
})

for (const variant of ['once', 'empty', 'nonfinite', 'unowned', 'foreign-after-read'] as const)
  it(`stack addition reads once and validates targets: ${variant}`, () => {
    const { battle, a, debuff } = makeScenario(1402)
    battles.push(battle)
    const other = makeScenario(1403)
    battles.push(other.battle)
    const marks = [0, 1].map(i => {
      const m = new BaseMark(`fixture/read-${i}` as baseMarkId, [], {
        ...debuff.config,
        maxStacks: 20,
      }).createInstance()
      m.stack = 3
      m.setOwner(a.activePet, battle.emitter)
      a.activePet.marks.push(m)
      return m
    })
    if (variant === 'unowned') marks[1].owner = null
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    let reads = 0
    const amount = selectFrom(variant === 'empty' ? [] : [2])
      .select(n => {
        reads++
        if (variant === 'foreign-after-read') marks[0].owner = other.a.activePet
        return variant === 'nonfinite' ? Infinity : n
      })
      .first()
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/gain-reads',
        triggers: [EffectTrigger.TurnEnd],
        apply: selectFrom(marks).apply(ops.addStacks(amount)),
      }),
    )
    const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0], effect)
    const apply = () => battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(context))
    if (['nonfinite', 'unowned', 'foreign-after-read'].includes(variant))
      expect(apply).toThrow(
        variant === 'nonfinite' ? 'Expected finite numeric input' : 'Cross-battle or unowned write target',
      )
    else apply()
    expect(marks.map(m => m.stack)).toEqual(variant === 'once' ? [5, 5] : [3, 3])
    expect(reads).toBe(['empty', 'unowned'].includes(variant) ? 0 : 1)
  })
