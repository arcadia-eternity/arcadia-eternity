import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  AddMarkContext,
  BaseMark,
  BattleMessageType,
  ConfigDurationType,
  ConfigModifier,
  ConfigModifierType,
  Effect,
  EffectContext,
  EffectTrigger,
  SnapshotCatalog,
  StackStrategy,
  TurnContext,
  defineMarkInstanceParams,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  const base = new BaseMark('ugc/burn' as baseMarkId, [], {
    ...f.debuff.config,
    maxStacks: 10,
    stackable: true,
    stackStrategy: StackStrategy.stack,
    mutexGroup: 'heat',
  })
  const ratio = Type.Number({ minimum: 0, maximum: 1, default: 0.2 })
  const params = defineMarkInstanceParams(base, Type.Object({ ratio }, { additionalProperties: false }), {
    ratio: { effectiveSchema: ratio, operations: [ConfigModifierType.delta] },
  })
  params.parameters.install(f.battle.configSystem)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  const add = (input = {}, target = f.a.activePet) => {
    const context = new AddMarkContext(parent, target, base, 1, 2, undefined, input)
    return { context, result: f.battle.addMark(context), mark: target.marks.find(mark => mark.base === base)! }
  }
  return { ...f, base, params, parent, add }
}

it('copies normalized arguments and installs them before OnMarkCreated, before insertion', () => {
  const f = fixture()
  const seen: unknown[] = []
  f.base.effects.push(
    new Effect<EffectTrigger>(
      'ugc/read-created' as effectId,
      [EffectTrigger.OnMarkCreated],
      ctx => {
        const source = ctx.source
        if (!('instanceParams' in source)) throw new Error('Expected mark')
        seen.push([f.params.read(ctx.battle.configSystem, source, 'ratio'), f.a.activePet.marks.includes(source)])
      },
      0,
    ),
  )
  const input = { ratio: 0 }
  const context = new AddMarkContext(f.parent, f.a.activePet, f.base, 1, 2, undefined, input)
  input.ratio = 0.8
  f.battle.addMark(context)
  expect(seen).toEqual([[0, false]])
  const mark = f.a.activePet.marks[0]
  expect(mark.instanceParams).toEqual({ ratio: 0 })
  expect(Object.isFrozen(mark.instanceParams)).toBe(true)
  expect(f.params.normalize({})).toEqual({ ratio: 0.2 })
  expect(() => f.add({ extra: 1 })).toThrow()
  expect(() => f.add({ ratio: 2 })).toThrow()
  expect(() => f.params.normalize(null)).toThrow()
})

it('merges equal base parameters despite effective modifiers and keeps the existing instance', () => {
  const f = fixture()
  const first = f.add().mark
  const cleanup = f.params.parameters.modify(
    f.battle.configSystem,
    f.params.address('ratio'),
    new ConfigModifier(ConfigDurationType.binding, 'ugc/ratio', 0.3, ConfigModifierType.delta, 0),
    first,
  )
  const second = f.add({ ratio: 0.2 })
  expect(second.result).toBeUndefined()
  expect(second.mark).toBe(first)
  expect(first.stack).toBe(2)
  expect(first.instanceParams).toEqual({ ratio: 0.2 })
  expect(f.params.read(f.battle.configSystem, first, 'ratio')).toBe(0.5)
  const other = f.add({ ratio: 0.8 }, f.a.team[1]).mark
  expect(f.params.read(f.battle.configSystem, other, 'ratio')).toBe(0.8)
  cleanup()
})

it('rejects conflicts after OnBeforeAddMark but before any mutex removal or stacking', () => {
  const f = fixture()
  const first = f.add().mark
  const unrelatedBase = new BaseMark('ugc/heat-other' as baseMarkId, [], f.base.config)
  const unrelated = unrelatedBase.createInstance()
  unrelated.setOwner(f.a.activePet, f.a.activePet.emitter!)
  f.a.activePet.marks.push(unrelated)
  let before = 0
  const observer = new BaseMark('observer' as baseMarkId, [
    new Effect<EffectTrigger>(
      'observer/before' as effectId,
      [EffectTrigger.OnBeforeAddMark],
      () => {
        before++
      },
      0,
    ),
  ]).createInstance()
  observer.setOwner(f.battle, f.battle.emitter)
  f.battle.marks.push(observer)
  const result = f.add({ ratio: 0.9 })
  expect(result.result).toBe('parameter-conflict')
  expect(before).toBe(1)
  expect(
    f.a.activePet.addMark(new AddMarkContext(f.parent, f.a.activePet, f.base, 1, 2, undefined, { ratio: 0.9 })),
  ).toBe('parameter-conflict')
  expect(first.stack).toBe(1)
  expect(f.a.activePet.marks).toEqual([first, unrelated])
  result.context.target = f.a.team[1]
  expect(f.battle.addMark(result.context)).toBeUndefined()
})

it('uses the final target selected by OnBeforeAddMark for parameter compatibility', () => {
  const f = fixture()
  const first = f.add({ ratio: 0.8 }, f.a.team[1]).mark
  const observer = new BaseMark('redirector' as baseMarkId, [
    new Effect<EffectTrigger>(
      'redirect' as effectId,
      [EffectTrigger.OnBeforeAddMark],
      ctx => {
        if (ctx.parent instanceof AddMarkContext) ctx.parent.target = f.a.team[1]
      },
      0,
    ),
  ]).createInstance()
  observer.setOwner(f.battle, f.battle.emitter)
  f.battle.marks.push(observer)
  expect(f.add({ ratio: 0.2 }).result).toBe('parameter-conflict')
  expect(f.a.activePet.marks).toEqual([])
  expect(first.stack).toBe(1)
})

it('leaves legacy mutex replacement unchanged and rejects undeclared parameter input', () => {
  const f = fixture()
  const legacy = new BaseMark('legacy' as baseMarkId, [], f.base.config)
  const add = () => f.battle.addMark(new AddMarkContext(f.parent, f.a.activePet, legacy, 1))
  add()
  const first = f.a.activePet.marks[0]
  add()
  expect(f.a.activePet.marks).toHaveLength(1)
  expect(f.a.activePet.marks[0]).not.toBe(first)
  expect(() => new AddMarkContext(f.parent, f.a.activePet, legacy, 1, undefined, undefined, { ratio: 0.2 })).toThrow(
    'does not declare',
  )
})

it('restores instance base identity and effective Config values without replaying creation', async () => {
  const f = fixture()
  const catalog = new SnapshotCatalog('mark-params/1').registerContent('burn', f.base)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(error => {
    expect(error.message).toBe('Battle cancelled')
  })
  await ready
  const mark = f.add({ ratio: 0.4 }).mark
  f.params.parameters.modify(
    f.battle.configSystem,
    f.params.address('ratio'),
    new ConfigModifier(ConfigDurationType.binding, 'persistent-ratio', 0.1, ConfigModifierType.delta, 0),
    mark,
  )
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  await f.battle.cleanup()
  await run
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  const restoredMark = restored.playerA.activePet.marks.find(m => m.base === f.base)!
  expect(restoredMark.instanceParams).toEqual({ ratio: 0.4 })
  expect(Object.isFrozen(restoredMark.instanceParams)).toBe(true)
  expect(f.params.read(restored.configSystem, restoredMark, 'ratio')).toBe(0.5)
  const again = JSON.parse(JSON.stringify(snapshotBattle(restored, catalog)))
  await restored.cleanup()
  const twice = restoreBattle(again, catalog)
  battles.push(twice)
  expect(f.params.read(twice.configSystem, twice.playerA.activePet.marks[0], 'ratio')).toBe(0.5)
  const bad = JSON.parse(JSON.stringify(saved))
  const node = bad.nodes.find(
    (item: { kind: string; fields: Record<string, unknown> }) =>
      item.kind === 'MarkInstanceImpl' && item.fields.instanceParams,
  )
  bad.nodes[node.fields.instanceParams.ref].fields.ratio = 0.9
  await twice.cleanup()
  expect(() => restoreBattle(bad, catalog)).toThrow('parameter scope')
})

it('releases instance Config scopes after destruction, preserving hook reads and shared definitions', () => {
  const f = fixture()
  const seen: number[] = []
  f.base.effects.push(
    new Effect<EffectTrigger>(
      'read-destroyed' as effectId,
      [EffectTrigger.OnMarkDestroy],
      ctx => {
        if (!('instanceParams' in ctx.source)) throw new Error('Expected mark')
        seen.push(f.params.read(ctx.battle.configSystem, ctx.source, 'ratio'))
      },
      0,
    ),
  )
  for (let i = 0; i < 3; i++) {
    const mark = f.add().mark
    f.params.parameters.modify(
      f.battle.configSystem,
      f.params.address('ratio'),
      new ConfigModifier(ConfigDurationType.binding, `cleanup/${i}`, 0.1, ConfigModifierType.delta, 0),
      mark,
    )
    mark.consumeStack(f.parent, 1)
    const state = f.battle.configSystem.exportSnapshotState()
    expect(state.scopedBase.has(mark)).toBe(false)
    expect(state.scopedModifiers.has(mark)).toBe(false)
    expect(f.a.activePet.marks).not.toContain(mark)
    expect(() => f.params.read(f.battle.configSystem, mark, 'ratio')).toThrow('not active')
  }
  expect(seen).toEqual([0.2 + 0.1, 0.2 + 0.1, 0.2 + 0.1])
  expect(f.params.read(f.battle.configSystem, f.add().mark, 'ratio')).toBe(0.2)
})

it('releases a newly installed scope when creation aborts before insertion', () => {
  const f = fixture()
  const mark = f.base.createInstance({ instanceParams: { ratio: 0.7 } })
  const context = new AddMarkContext(f.parent, f.a.activePet, f.base)
  const original = f.battle.applyEffects.bind(f.battle)
  const spy = vi.spyOn(f.battle, 'applyEffects').mockImplementation((parent, trigger, ...sources) => {
    if (trigger === EffectTrigger.OnAnyMarkAdded) throw new Error('creation aborted')
    return original(parent, trigger, ...sources)
  })
  try {
    expect(() => mark.OnMarkCreated(f.a.activePet, context)).toThrow('creation aborted')
    expect(f.battle.configSystem.exportSnapshotState().scopedBase.has(mark)).toBe(false)
    expect(f.a.activePet.marks).not.toContain(mark)
  } finally {
    spy.mockRestore()
  }
})
