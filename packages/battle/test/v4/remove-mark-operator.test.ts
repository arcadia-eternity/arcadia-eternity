import { afterEach, beforeAll, expect, it } from 'vitest'
import { Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  RemoveMarkContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const { compileEffect, defineEffect, targets, contexts, selectFrom, ops, actions } = effectAuthoring
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'reverse',
  'duplicate',
  'empty',
  'indestructible',
  'inactive',
  'remove-next',
  'add-new',
] as const
function run(native: boolean, global: boolean, variant: (typeof variants)[number]) {
  const { battle, a, debuff } = makeScenario(411)
  battles.push(battle)
  const owner = global ? battle : a.activePet
  const source = a.activePet.skills[0]
  const context = new EffectContext<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  const trace: string[] = []
  const add = (name: string, destroyable = true) => {
    const m = new BaseMark(`fixture/remove-${name}` as baseMarkId, [], {
      ...debuff.config,
      destroyable,
    }).createInstance()
    m.owner = owner
    owner.marks.push(m)
    m.effects.push(
      defineNativeEffect({
        id: `fixture/destroy-${name}` as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          trace.push(name)
        },
      }),
    )
    return m
  }
  const first = add('first', variant !== 'indestructible'),
    second = add('second')
  if (variant === 'inactive') {
    first.isActive = false
    first.owner = null
    owner.marks = owner.marks.filter(m => m !== first)
  }
  first.effects.push(
    defineNativeEffect({
      id: 'fixture/remove-hook' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply(c) {
        if (variant === 'remove-next') battle.removeMark(new RemoveMarkContext(c, second))
        if (variant === 'add-new') add('new')
      },
    }),
  )
  const selected =
    variant === 'empty'
      ? []
      : variant === 'reverse'
        ? [second, first]
        : variant === 'duplicate'
          ? [first, first, second]
          : [first, second]
  if (native) {
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/remove',
        triggers: [EffectTrigger.TurnEnd],
        apply: selectFrom(selected).apply(ops.removeMark()),
      }),
    )
    const apply = effect.apply
    if (typeof apply !== 'function') throw new Error('Expected compiled action')
    battle.executionBudget.run(battle.currentTurn, () => apply(context))
  } else Operators.destroyMark()(context, selected)
  return {
    trace,
    active: [first.isActive, second.isActive],
    owners: [first.owner !== null, second.owner !== null],
    remaining: owner.marks.map(m => m.baseId),
  }
}
for (const global of [false, true])
  it.each(variants)(`removes marks through legacy lifecycle, global=${global}: %s`, variant => {
    const result = run(true, global, variant)
    expect(result).toEqual(run(false, global, variant))
    expect(result.trace).toEqual(
      variant === 'empty'
        ? []
        : variant === 'reverse'
          ? ['second', 'first']
          : ['indestructible', 'inactive'].includes(variant)
            ? ['second']
            : ['first', 'second'],
    )
    expect(result.active).toEqual(
      variant === 'empty' ? [true, true] : variant === 'indestructible' ? [true, false] : [false, false],
    )
    expect(result.remaining).toEqual(
      variant === 'empty'
        ? ['fixture/remove-first', 'fixture/remove-second']
        : variant === 'indestructible'
          ? ['fixture/remove-first']
          : variant === 'add-new'
            ? ['fixture/remove-new']
            : [],
    )
  })

for (const global of [false, true])
  it(`sequences requery later targets and values after removal callbacks, global=${global}`, () => {
    const { battle, a, debuff } = makeScenario()
    battles.push(battle)
    const owner = global ? battle : a.activePet
    const old = new BaseMark('fixture/sequence-old' as baseMarkId, [], debuff.config).createInstance()
    old.stack = 3
    old.owner = owner
    owner.marks.push(old)
    const added = new BaseMark('fixture/sequence-new' as baseMarkId, [], {
      ...debuff.config,
      maxStacks: 10,
    }).createInstance()
    added.stack = 7
    old.effects.push(
      defineNativeEffect({
        id: 'fixture/spawn' as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          added.owner = owner
          owner.marks.push(added)
        },
      }),
    )
    const query = global ? contexts.battle.flatMap(b => b.marks) : targets.ownerMarks
    const values = query.select(mark => mark.stack).all()
    const reads: number[][] = []
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/sequence',
        triggers: [EffectTrigger.TurnEnd],
        apply: actions.sequence(
          ctx => {
            reads.push([...ctx.read(values)])
          },
          query.apply(ops.removeMark()),
          ctx => {
            reads.push([...ctx.read(values)])
          },
          query.apply(ops.consumeStacks(2)),
          ctx => {
            reads.push([...ctx.read(values)])
          },
          query.apply(ops.removeMark()),
          ctx => {
            reads.push([...ctx.read(values)])
          },
        ),
      }),
    )
    const apply = effect.apply
    if (typeof apply !== 'function') throw new Error('Expected compiled action')
    battle.executionBudget.run(battle.currentTurn, () =>
      apply(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0])),
    )
    expect(reads).toEqual([[3], [7], [5], []])
    expect(old.isActive).toBe(false)
    expect(added.isActive).toBe(false)
  })

it('prevalidates foreign active targets before any removal', () => {
  const f = makeScenario(),
    foreign = makeScenario()
  battles.push(f.battle, foreign.battle)
  const local = f.debuff.createInstance(),
    remote = foreign.debuff.createInstance()
  local.owner = f.a.activePet
  f.a.activePet.marks.push(local)
  remote.owner = foreign.a.activePet
  foreign.a.activePet.marks.push(remote)
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/foreign-remove',
      triggers: [EffectTrigger.TurnEnd],
      apply: selectFrom([local, remote]).apply(ops.removeMark()),
    }),
  )
  const apply = effect.apply
  if (typeof apply !== 'function') throw new Error('Expected compiled action')
  expect(() =>
    f.battle.executionBudget.run(f.battle.currentTurn, () =>
      apply(new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0])),
    ),
  ).toThrow('Cross-battle')
  expect(local.isActive).toBe(true)
  expect(remote.isActive).toBe(true)
})

it('rechecks a later active target after lifecycle callbacks transfer its owner', () => {
  const f = makeScenario(),
    foreign = makeScenario()
  battles.push(f.battle, foreign.battle)
  const first = new BaseMark('fixture/first' as baseMarkId, [], f.debuff.config).createInstance(),
    second = new BaseMark('fixture/second' as baseMarkId, [], f.debuff.config).createInstance()
  for (const m of [first, second]) {
    m.owner = f.a.activePet
    f.a.activePet.marks.push(m)
  }
  first.effects.push(
    defineNativeEffect({
      id: 'fixture/transfer' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply() {
        second.owner = foreign.a.activePet
      },
    }),
  )
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/recheck',
      triggers: [EffectTrigger.TurnEnd],
      apply: selectFrom([first, second]).apply(ops.removeMark()),
    }),
  )
  const apply = effect.apply
  if (typeof apply !== 'function') throw new Error('Expected compiled action')
  expect(() =>
    f.battle.executionBudget.run(f.battle.currentTurn, () =>
      apply(new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0])),
    ),
  ).toThrow('Cross-battle')
  expect(first.isActive).toBe(false)
  expect(second.isActive).toBe(true)
})
