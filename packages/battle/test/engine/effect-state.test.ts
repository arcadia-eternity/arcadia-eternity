import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import {
  AddMarkContext,
  BaseMark,
  Effect,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  SnapshotCatalog,
  TurnContext,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type baseMarkId,
  type effectId,
} from '../../engine'
import { defineEffectState, getEffectState, setEffectState } from '../../authoring'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const result = makeScenario(242, undefined, false, undefined, undefined, { enabled: false })
  battles.push(result.battle)
  return result
}
function context(battle: Battle) {
  return new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, battle.playerA.activePet.skills[0])
}
const hits = defineEffectState({ id: 'test:hit-count', type: 'number', default: 0 })

it('keeps scalar state in an exact entity scope, isolated across instances and battles', () => {
  const a = fixture(),
    b = fixture(),
    ctx = context(a.battle)
  const pet = a.a.activePet,
    skill = pet.skills[0],
    other = a.a.team[1].skills[0]
  setEffectState(ctx, pet, hits, 7)
  expect(getEffectState(ctx, skill, hits)).toBe(0)
  setEffectState(ctx, skill, hits, 2)
  expect(getEffectState(ctx, skill, hits)).toBe(2)
  expect(getEffectState(ctx, other, hits)).toBe(0)
  expect(getEffectState(ctx, pet, hits)).toBe(7)
  expect(getEffectState(context(b.battle), b.a.activePet.skills[0], hits)).toBe(0)
  expect(() => setEffectState(ctx, b.a.activePet, hits, 4)).toThrow(/belong/)
})

it('validates values and rejects incompatible declarations of the same state ID', () => {
  const f = fixture(),
    ctx = context(f.battle),
    pet = f.a.activePet
  setEffectState(ctx, pet, hits, 2)
  expect(() => setEffectState(ctx, pet, hits, Infinity)).toThrow(/state/i)
  expect(() => setEffectState(ctx, pet, hits, 'wrong' as never)).toThrow(/state/i)
  expect(() => setEffectState(ctx, pet, hits, (() => 2) as never)).toThrow(/state/i)
  expect(() => defineEffectState({ id: 'test:bad', type: 'number', default: NaN })).toThrow(/state/i)
  expect(Object.isFrozen(hits)).toBe(true)
  expect(() => setEffectState(ctx, pet, hits, ctx as never)).toThrow(/state/i)
  expect(() => defineEffectState({ id: 'unqualified', type: 'number', default: 0 })).toThrow(/ID/)
  const incompatible = defineEffectState({ id: hits.id, type: 'number', default: 1 })
  expect(() => getEffectState(ctx, pet, incompatible)).toThrow(/conflict/i)
  const equivalent = defineEffectState({ id: hits.id, type: 'number', default: 0 })
  expect(getEffectState(ctx, pet, equivalent)).toBe(2)
  const flag = defineEffectState({ id: 'test:used', type: 'boolean', default: false })
  const label = defineEffectState({ id: 'test:stage', type: 'string', default: 'idle' })
  setEffectState(ctx, f.battle, flag, true)
  setEffectState(ctx, f.a, label, 'active')
  expect(getEffectState(ctx, f.battle, flag)).toBe(true)
  expect(getEffectState(ctx, f.a, label)).toBe('active')
})

it('round trips state through a fresh battle snapshot and retains definition conflict checks', async () => {
  const f = fixture(),
    ctx = context(f.battle)
  setEffectState(ctx, f.a.activePet.skills[0], hits, 3)
  setEffectState(ctx, f.battle, hits, 9)
  const catalog = new SnapshotCatalog('state-test')
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog, { boundary: 'initial' })))
  await f.battle.cleanup()
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  const next = context(restored)
  expect(getEffectState(next, restored.playerA.activePet.skills[0], hits)).toBe(3)
  expect(getEffectState(next, restored, hits)).toBe(9)
  setEffectState(next, restored.playerA.activePet.skills[0], hits, 4)
  expect(getEffectState(next, restored.playerA.activePet.skills[0], hits)).toBe(4)
  expect(() => getEffectState(next, restored, defineEffectState({ id: hits.id, type: 'number', default: 1 }))).toThrow(
    /conflict/i,
  )
  const invalid = structuredClone(saved)
  for (const node of invalid.nodes)
    for (const [key, value] of Object.entries(node.fields))
      if (value === JSON.stringify(['number', 0])) node.fields[key] = JSON.stringify(['number', 'wrong'])
  await restored.cleanup()
  expect(() => restoreBattle(invalid, catalog)).toThrow(/state/i)
})

it('releases a destroyed mark scope and does not transfer its state to a replacement instance', () => {
  const f = fixture(),
    ctx = context(f.battle),
    pet = f.a.activePet
  pet.addMark(new AddMarkContext(ctx, pet, f.debuff))
  const mark = pet.marks.find(mark => mark.base === f.debuff)!
  setEffectState(ctx, mark, hits, 3)
  f.battle.removeMark(new RemoveMarkContext(ctx, mark))
  expect(() => getEffectState(ctx, mark, hits)).toThrow(/belong/)
  expect(f.battle.configSystem.exportSnapshotState().scopedBase.has(mark)).toBe(false)
  pet.addMark(new AddMarkContext(ctx, pet, f.debuff))
  const replacement = pet.marks.find(mark => mark.base === f.debuff)!
  expect(replacement).not.toBe(mark)
  expect(getEffectState(ctx, replacement, hits)).toBe(0)
})

it('makes state available during creation and releases it when creation fails', () => {
  const f = fixture(),
    ctx = context(f.battle),
    pet = f.a.activePet
  const base = new BaseMark(
    'state/created' as baseMarkId,
    [
      new Effect<EffectTrigger>(
        'state/initialize' as effectId,
        [EffectTrigger.OnMarkCreated],
        frame => {
          expect(getEffectState(frame, frame.source, hits)).toBe(0)
          setEffectState(frame, frame.source, hits, 5)
        },
        0,
      ),
    ],
    f.debuff.config,
  )
  pet.addMark(new AddMarkContext(ctx, pet, base))
  expect(getEffectState(ctx, pet.marks.find(mark => mark.base === base)!, hits)).toBe(5)
  const failing = new BaseMark(
    'state/failed' as baseMarkId,
    [
      new Effect<EffectTrigger>(
        'state/initialize-failure' as effectId,
        [EffectTrigger.OnMarkCreated],
        frame => {
          setEffectState(frame, frame.source, hits, 9)
        },
        0,
      ),
    ],
    f.debuff.config,
  )
  const mark = failing.createInstance()
  const apply = f.battle.applyEffects.bind(f.battle)
  const spy = vi.spyOn(f.battle, 'applyEffects').mockImplementation((parent, trigger, ...sources) => {
    if (trigger === EffectTrigger.OnAnyMarkAdded) throw new Error('creation failed')
    return apply(parent, trigger, ...sources)
  })
  try {
    expect(() => mark.OnMarkCreated(pet, new AddMarkContext(ctx, pet, failing))).toThrow('creation failed')
    expect(f.battle.configSystem.exportSnapshotState().scopedBase.has(mark)).toBe(false)
  } finally {
    spy.mockRestore()
  }
})

it('keeps state on direct transfer and releases the absorbed instance on merge', () => {
  const f = fixture(),
    ctx = context(f.battle),
    source = f.a.activePet,
    next = f.a.team[1],
    target = f.b.activePet
  source.addMark(new AddMarkContext(ctx, source, f.debuff))
  target.addMark(new AddMarkContext(ctx, target, f.debuff))
  const incoming = source.marks.find(mark => mark.base === f.debuff)!,
    existing = target.marks.find(mark => mark.base === f.debuff)!
  setEffectState(ctx, incoming, hits, 3)
  setEffectState(ctx, existing, hits, 7)
  next.transferMarks(ctx, incoming)
  expect(getEffectState(ctx, incoming, hits)).toBe(3)
  expect(next.marks).toContain(incoming)
  target.transferMarks(ctx, incoming)
  expect(getEffectState(ctx, existing, hits)).toBe(7)
  expect(() => getEffectState(ctx, incoming, hits)).toThrow(/belong/)
  expect(f.battle.configSystem.exportSnapshotState().scopedBase.has(incoming)).toBe(false)
})

// Compile-time author contract: the scalar tag determines both default and write type.
function stateTypeContract(ctx: EffectContext<EffectTrigger>) {
  // @ts-expect-error A numeric field cannot have a string default.
  defineEffectState({ id: 'test:type', type: 'number', default: 'wrong' })
  // @ts-expect-error A numeric field cannot receive a boolean.
  setEffectState(ctx, ctx.source, hits, true)
  const value: number = getEffectState(ctx, ctx.source, hits)
  void value
}
void stateTypeContract
