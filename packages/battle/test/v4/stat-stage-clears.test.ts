import {
  EffectContext,
  EffectTrigger,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  TurnContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
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
for (const nextStat of [false, true])
  it(`stage traversal snapshots each stat on arrival, nextStat=${nextStat}`, () => {
    const { battle, a } = makeScenario(1604)
    battles.push(battle)
    const pet = a.activePet
    const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, pet.skills[0])
    pet.addStatStage(context, StatTypeWithoutHp.atk, 2)
    pet.addStatStage(context, StatTypeWithoutHp.spa, -3)
    const atk = pet.marks.find(
      (m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl && m.statType === 'atk',
    )!
    const spa = pet.marks.find(
      (m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl && m.statType === 'spa',
    )!
    const added = (nextStat ? spa : atk).base.createInstance()
    added.level = 4
    atk.effects.push(
      defineNativeEffect({
        id: 'fixture/traversal-add' as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          added.setOwner(pet, battle.emitter)
          pet.marks.push(added)
        },
      }),
    )
    pet.clearStatStage(context)
    expect(atk.isActive).toBe(false)
    expect(spa.isActive).toBe(true)
    expect(added.isActive).toBe(!nextStat)
    expect(pet.marks.includes(added)).toBe(!nextStat)
  })
