import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { EffectParser, MarkParser } from '@arcadia-eternity/battle/v4/legacy'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import {
  AttributeSystem,
  BaseMark,
  AddMarkContext,
  BattleMessageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  RemoveMarkContext,
  SwitchPetPhase,
  effectAuthoring,
  defineNativeEffect,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'
import { createOfficialAuthoredEffects } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_reduce_speed_ruodian'
const definitions = (kind: string) =>
  parse(
    readFileSync(
      new URL(
        `${kind.startsWith('effect_') ? './fixtures/effect-regression' : '../../../../packs/base/data'}/${kind}.yaml`,
        import.meta.url,
      ),
      'utf8',
    ),
    {
      merge: true,
    },
  ) as { id: string }[]
const source = definitions('effect_mark').find(definition => definition.id === id)!
const markDefinition = definitions('mark').find(definition => definition.id === 'mark_ruodianjihao')!
const systems: LocalBattleSystemV4[] = []
const battles: Battle[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  for (const system of systems.splice(0)) await system.cleanup()
  for (const battle of battles.splice(0)) await battle.cleanup()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
})
function fixture(native: boolean) {
  const f = makeScenario(1401)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const effect = native ? createOfficialAuthoredEffects()[id] : EffectParser.parse(source)
  const mark = MarkParser.parse({ ...markDefinition, effect: [] })
  mark.effects.push(effect)
  const catalog = catalogFor(f)
  catalog.registerContent('mark:weakness-speed', mark)
  if (native) effectAuthoring.registerEffect(catalog, effect)
  else catalog.registerEffect(id, effect)
  f.a.activePet.attributeSystem.updateBaseValue('spe', 300)
  f.a.activePet.attributeSystem.updateBaseValue('spd', 340)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0])
  const add = () => f.battle.addMark(new AddMarkContext(parent, f.a.team[0], mark, 1))
  return { ...f, effect, mark, catalog, parent, add }
}

it(`${id}: matches unchanged YAML through real creation, merging, suppression, switching and destruction`, () => {
  const traces: number[][][] = []
  for (const native of [false, true]) {
    const f = fixture(native)
    const pet = f.a.activePet
    const errors: BattleMessageType[] = []
    const membershipAtCreation: boolean[] = []
    f.mark.effects.push(
      defineNativeEffect({
        id: 'fixture/weakness-membership' as effectId,
        triggers: [EffectTrigger.OnMarkCreated],
        apply: context => {
          membershipAtCreation.push(pet.marks.some(mark => mark === context.source))
        },
      }),
    )
    f.battle.registerListener(message => {
      if (([BattleMessageType.Error, BattleMessageType.EffectApplyFail] as BattleMessageType[]).includes(message.type))
        errors.push(message.type)
    })
    const trace: number[][] = []
    const read = () => trace.push([pet.stat.spe, pet.stat.spd])
    read()
    f.add()
    const instance = pet.marks.find(mark => mark.baseId === f.mark.id)!
    expect(instance.effects).toContain(f.mark.effects[0])
    read()
    f.add()
    expect(pet.marks.filter(mark => mark.baseId === f.mark.id)).toHaveLength(1)
    expect(instance.stack).toBe(2)
    read()
    instance.isSuppressed = true
    read()
    instance.isSuppressed = false
    read()
    instance.consumeStack(f.parent, 1)
    read()
    const change = new SwitchPetPhase(f.battle, f.a, f.a.team[1], new TurnContext(f.battle))
    change.initialize()
    change.execute()
    expect(f.a.activePet).toBe(f.a.team[1])
    expect(instance.owner).toBe(pet)
    read()
    instance.consumeStack(f.parent, 1)
    expect(instance.isActive).toBe(false)
    expect(instance.owner).toBeNull()
    read()
    f.add()
    const replacement = pet.marks.find(mark => mark.baseId === f.mark.id)!
    expect(replacement).not.toBe(instance)
    read()
    replacement.consumeStack(f.parent, 1)
    read()
    expect(errors).toEqual([])
    expect(membershipAtCreation).toEqual([false, false])
    // OnMarkCreated runs before source insertion. A binding capture of an empty
    // selfMarks selection remains empty; merging is not another creation event.
    expect(trace).toEqual(Array.from({ length: 10 }, () => [300, 340]))
    traces.push(trace)
  }
  expect(traces[1]).toEqual(traces[0])
})

it(`${id}: suspends a destroyed captured input under the reviewed missing-value contract (C20)`, () => {
  const results = []
  for (const native of [false, true]) {
    const f = fixture(native)
    f.add()
    f.add()
    const pet = f.a.activePet
    const input = pet.marks.find(mark => mark.baseId === f.mark.id)!
    const observerBase = new BaseMark('fixture/weakness-observer' as baseMarkId, [f.effect], f.mark.config)
    f.battle.addMark(new AddMarkContext(f.parent, pet, observerBase, 1))
    const observer = pet.marks.find(mark => mark.base === observerBase)!
    const trace = [pet.stat.spe]
    expect(trace).toEqual([250])
    f.battle.removeMark(new RemoveMarkContext(f.parent, input))
    expect(input.stack).toBe(2)
    expect(input.isActive).toBe(false)
    trace.push(pet.stat.spe)
    f.add()
    trace.push(pet.stat.spe)
    f.battle.removeMark(new RemoveMarkContext(f.parent, observer))
    trace.push(pet.stat.spe)
    results.push(trace)
  }
  expect(results[0]).toEqual([250, 250, 250, 300])
  expect(results[1]).toEqual([250, 300, 300, 300])
})

it(`${id}: restores its actual source-mark binding without replaying creation`, async () => {
  const f = fixture(true)
  f.add()
  f.add()
  const system = new LocalBattleSystemV4(f.battle, {
    snapshot: battle => snapshotBattle(battle, f.catalog),
    restore: data => restoreBattle(data, f.catalog),
  })
  systems.push(system)
  await system.ready()
  const saved = JSON.parse(JSON.stringify(await system.createRuntimeSnapshot()))
  const continueBinding = (battle: Battle) => {
    const pet = battle.playerA.activePet
    const mark = pet.marks.find(mark => mark.baseId === 'mark_ruodianjihao')!
    const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, pet.skills[0])
    const trace = [pet.stat.spe]
    mark.consumeStack(parent, 1)
    trace.push(pet.stat.spe)
    mark.consumeStack(parent, 1)
    trace.push(pet.stat.spe)
    return trace
  }
  const expected = continueBinding(f.battle)
  expect(expected).toEqual([300, 300, 300])
  await system.cleanup()
  const fresh = fixture(true)
  let restored: Battle | undefined
  const restore = new LocalBattleSystemV4(fresh.battle, {
    snapshot: battle => snapshotBattle(battle, fresh.catalog),
    restore: data => (restored = restoreBattle(data, fresh.catalog)),
  })
  systems.push(restore)
  await restore.restoreRuntimeSnapshot(saved)
  const events: BattleMessageType[] = []
  restore.BattleEvent(message => events.push(message.type))
  await restore.ready()
  expect(events).not.toContain(BattleMessageType.MarkApply)
  expect(continueBinding(restored!)).toEqual(expected)
})
