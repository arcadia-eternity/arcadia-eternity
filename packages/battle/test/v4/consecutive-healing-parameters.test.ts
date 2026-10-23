import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import {
  AttributeSystem,
  ConfigSystem,
  BaseMark,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  BattleMessageType,
  effectAuthoring,
  parameterAddress,
  defineNativeEffect,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type SkillInstance,
  type MarkInstance,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'
import { officialConsecutiveHealingEffects } from '@arcadia-eternity/data-pack-base/native'

const ids = [
  'effect_skill_heal_self_120_hp_if_consecutive_half',
  'effect_skill_heal_self_125_hp_if_consecutive_half',
] as const
type Id = (typeof ids)[number]
const definitions: { id: string }[] = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const battles: Battle[] = []
const systems: LocalBattleSystemV4[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const system of systems.splice(0)) await system.cleanup()
  for (const battle of battles.splice(0)) await battle.cleanup()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
})
function fire(battle: Battle, source: SkillInstance | MarkInstance, times: number) {
  const pet = source.owner
  if (!pet || !('skills' in pet)) throw new Error('Expected an owned pet source')
  pet.lastSkillUsedTimes = times
  pet.currentHp = 11
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), pet.owner!, pet, AttackTargetOpinion.opponent, pet.skills[0]),
    EffectTrigger.OnHit,
    source,
  )
  return pet.currentHp - 11
}
function fixture(id: Id, native: boolean, kind: 'skill' | 'mark') {
  const global = ConfigSystem.getInstance()
  const previous = new Set(global.getRegisteredKeys())
  const effect = native
    ? officialConsecutiveHealingEffects[id]
    : EffectParser.parse(definitions.find(definition => definition.id === id))
  const keys = native
    ? [parameterAddress(id, 'parameters', 'trueValue'), parameterAddress(id, 'parameters', 'falseValue')]
    : global.getRegisteredKeys().filter(key => !previous.has(key) && key.startsWith(`${id}.`))
  expect(keys).toHaveLength(2)
  const f = makeScenario(1501)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.attributeSystem.updateBaseValue('maxHp', 407)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const source: SkillInstance | MarkInstance =
    kind === 'skill'
      ? f.a.activePet.skills[0]
      : (() => {
          const base = new BaseMark('fixture/consecutive-parameter' as baseMarkId, [], f.debuff.config)
          f.battle.addMark(
            new AddMarkContext(
              new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0]),
              f.a.activePet,
              base,
            ),
          )
          return f.a.activePet.marks.find(mark => mark.base === base)!
        })()
  source.effects.push(effect)
  if (native) effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const set = (yes: number, no: number, scope = source) => {
    if (native) {
      const catalog = effectAuthoring.effectParameters(effect)
      catalog.set(f.battle.configSystem, keys[0], yes, scope)
      catalog.set(f.battle.configSystem, keys[1], no, scope)
    } else {
      f.battle.configSystem.set(keys[0], yes, scope)
      f.battle.configSystem.set(keys[1], no, scope)
    }
  }
  return { ...f, source, effect, keys, set }
}

for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    for (const times of [1, 2])
      for (const [yes, no] of [
        [7.5, 0],
        [0, -3.5],
      ])
        it(`${id} ${kind}: retains anonymous branch parameters ${yes}/${no} at use ${times}`, () => {
          const outcomes = []
          for (const native of [false, true]) {
            const f = fixture(id, native, kind)
            f.set(yes, no)
            f.battle.configSystem.set(f.keys[0], 300, f.b.activePet.skills[0])
            const amounts: number[] = []
            f.a.activePet.skills[0].effects.push(
              defineNativeEffect({
                id: 'fixture/consecutive-sampled-amount' as effectId,
                triggers: [EffectTrigger.OnBeforeHeal],
                apply: context => {
                  amounts.push(context.parent.baseHeal)
                },
              }),
            )
            const unselected = f.keys[times > 1 ? 1 : 0]
            const get = f.battle.configSystem.get.bind(f.battle.configSystem)
            let unselectedReads = 0
            vi.spyOn(f.battle.configSystem, 'get').mockImplementation((key, scope) => {
              if (key === unselected) {
                unselectedReads++
                throw new Error('Unselected branch was read')
              }
              return get(key, scope)
            })
            outcomes.push(fire(f.battle, f.source, times))
            expect(unselectedReads).toBe(0)
            expect(amounts).toEqual([times > 1 ? yes : no])
          }
          const expected = Math.floor(Math.max(0, times > 1 ? yes : no))
          expect(outcomes).toEqual([expected, expected])
        })

for (const id of ids)
  it(`${id}: reads edited branch configuration after admission`, () => {
    for (const native of [false, true]) {
      const f = fixture(id, native, 'skill')
      f.set(7, 9)
      f.a.activePet.skills[0].effects.push(
        defineNativeEffect({
          id: 'fixture/consecutive-late-parameter' as effectId,
          triggers: [EffectTrigger.BeforeEffect],
          when: context => context.parent instanceof EffectContext && context.parent.effect?.id === id,
          apply: () => f.set(13.5, 17.5),
        }),
      )
      expect(fire(f.battle, f.source, 1)).toBe(17)
      expect(fire(f.battle, f.source, 2)).toBe(13)
    }
  })

for (const id of ids)
  it(`${id}: retains both scoped amounts through a fresh host snapshot`, async () => {
    const f = fixture(id, true, 'skill')
    f.set(7.5, 11.5)
    const catalog = catalogFor(f)
    effectAuthoring.registerEffect(catalog, f.effect)
    const system = new LocalBattleSystemV4(f.battle, {
      snapshot: battle => snapshotBattle(battle, catalog),
      restore: data => restoreBattle(data, catalog),
    })
    systems.push(system)
    await system.ready()
    const saved = JSON.parse(JSON.stringify(await system.createRuntimeSnapshot()))
    expect([fire(f.battle, f.source, 1), fire(f.battle, f.source, 2)]).toEqual([11, 7])
    await system.cleanup()
    const fresh = fixture(id, true, 'skill')
    fresh.set(100, 200)
    const freshCatalog = catalogFor(fresh)
    effectAuthoring.registerEffect(freshCatalog, fresh.effect)
    let restored: Battle | undefined
    const host = new LocalBattleSystemV4(fresh.battle, {
      snapshot: battle => snapshotBattle(battle, freshCatalog),
      restore: data => (restored = restoreBattle(data, freshCatalog)),
    })
    systems.push(host)
    await host.restoreRuntimeSnapshot(saved)
    const events: BattleMessageType[] = []
    host.BattleEvent(message => events.push(message.type))
    await host.ready()
    const source = restored!.playerA.activePet.skills[0]
    expect([fire(restored!, source, 1), fire(restored!, source, 2)]).toEqual([11, 7])
    expect(events).not.toContain(BattleMessageType.BattleStart)
  })
