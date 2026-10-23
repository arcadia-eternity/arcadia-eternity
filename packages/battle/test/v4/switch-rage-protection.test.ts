import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  effectAuthoring,
  BaseMark,
  SwitchPetPhase,
  SwitchPetContext,
  RageContext,
  EffectTrigger,
  TurnContext,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createSwitchRageProtection } from '@arcadia-eternity/data-pack-base/native'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture(location: 'outgoing' | 'incoming' | 'opponent' | 'none' = 'outgoing') {
  const f = makeScenario()
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const outgoing = f.a.activePet,
    incoming = f.a.team[1]
  const owner = location === 'incoming' ? incoming : location === 'opponent' ? f.b.activePet : outgoing
  const mark = new BaseMark('mark_feixuanzhen' as baseMarkId, [createSwitchRageProtection()], {
    ...f.debuff.config,
    persistent: true,
    duration: -1,
    maxStacks: 1,
    keepOnSwitchOut: true,
    transferOnSwitch: false,
    inheritOnFaint: false,
  }).createInstance()
  mark.setOwner(owner, f.battle.emitter)
  if (location !== 'none') owner.marks.push(mark)
  const turn = new TurnContext(f.battle)
  const switchTo = (pet = incoming) => {
    const phase = new SwitchPetPhase(f.battle, f.a, pet, turn)
    phase.initialize()
    phase.execute()
  }
  return { ...f, outgoing, incoming, mark, turn, switchTo }
}
for (const rage of [0, 1, 4, 9, 10, 99, 100, 10.5])
  for (const protectedSwitch of [false, true])
    it(`real switch preserves ${rage} with protection=${protectedSwitch}`, () => {
      const f = fixture(protectedSwitch ? 'outgoing' : 'none')
      f.a.settingRage(rage)
      f.switchTo()
      expect(f.a.activePet).toBe(f.incoming)
      expect(f.a.currentRage).toBe(protectedSwitch ? rage : Math.floor(rage * 0.8))
      expect(f.mark.isActive).toBe(!protectedSwitch || rage === 0)
      if (protectedSwitch && rage > 0) expect(f.mark.owner).toBeNull()
    })
for (const location of ['incoming', 'opponent'] as const)
  it(`${location} mark cannot protect the outgoing pet`, () => {
    const f = fixture(location)
    f.a.settingRage(100)
    f.switchTo()
    expect(f.a.currentRage).toBe(80)
    expect(f.mark.isActive).toBe(true)
  })
it('suppressed protection does not cancel or consume', () => {
  const f = fixture()
  f.mark.isSuppressed = true
  f.a.settingRage(100)
  f.switchTo()
  expect(f.a.currentRage).toBe(80)
  expect(f.mark.isActive).toBe(true)
})
for (const invalid of ['same', 'dead'] as const)
  it(`invalid ${invalid} switch does not charge rage or consume protection`, () => {
    const f = fixture()
    f.a.settingRage(100)
    if (invalid === 'dead') f.incoming.isAlive = false
    f.switchTo(invalid === 'same' ? f.outgoing : f.incoming)
    expect(f.a.activePet).toBe(f.outgoing)
    expect(f.a.currentRage).toBe(100)
    expect(f.mark.isActive).toBe(true)
  })
it('protection is consumed once, and the following switch pays its loss', () => {
  const f = fixture()
  f.a.settingRage(100)
  f.switchTo()
  expect(f.a.currentRage).toBe(100)
  f.switchTo(f.outgoing)
  expect(f.a.currentRage).toBe(80)
  expect(f.mark.isActive).toBe(false)
})
it('unrelated rage loss keeps the mark', () => {
  const f = fixture()
  f.a.settingRage(100)
  f.a.addRage(new RageContext(f.turn, f.a, 'skill', 'reduce', 20))
  expect(f.a.currentRage).toBe(80)
  expect(f.mark.isActive).toBe(true)
})
it('requires actual switch ancestry and matching target', () => {
  const f = fixture()
  f.a.settingRage(100)
  f.a.addRage(new RageContext(f.turn, f.a, 'switch', 'reduce', 20))
  expect(f.a.currentRage).toBe(80)
  const context = new SwitchPetContext(f.turn, f.a, f.incoming)
  f.b.settingRage(100)
  f.b.addRage(new RageContext(context, f.b, 'switch', 'reduce', 20))
  expect(f.b.currentRage).toBe(80)
  expect(f.mark.isActive).toBe(true)
})
it('entry effects precede loss; cancellation removes the mark without emitting a paid-loss event', () => {
  const f = fixture()
  const trace: string[] = []
  f.b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/switch-order' as effectId,
      triggers: [
        EffectTrigger.OnSwitchIn,
        EffectTrigger.BeforeRageLoss,
        EffectTrigger.OnRageLoss,
        EffectTrigger.OnMarkDestroy,
      ],
      priority: 100,
      apply: ctx => {
        expect(f.a.activePet).toBe(f.incoming)
        trace.push(ctx.trigger)
        if (ctx.trigger === EffectTrigger.OnSwitchIn) f.a.settingRage(75)
      },
    }),
  )
  f.mark.effects.push(
    defineNativeEffect({
      id: 'fixture/protection-destroyed' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply: () => {
        expect(f.mark.owner).toBe(f.outgoing)
        trace.push(EffectTrigger.OnMarkDestroy)
      },
    }),
  )
  f.battle.registerListener(message => {
    if (message.type === BattleMessageType.RageChange) trace.push('rage-message')
  })
  f.a.settingRage(100)
  f.switchTo()
  expect(trace).toEqual([EffectTrigger.OnSwitchIn, EffectTrigger.BeforeRageLoss, EffectTrigger.OnMarkDestroy])
  expect(f.a.currentRage).toBe(75)
  expect(f.mark.isActive).toBe(false)
})
it('ordinary switch loss supports existing numeric rage modifiers', () => {
  const f = fixture('none')
  f.b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/switch-modifier' as effectId,
      triggers: [EffectTrigger.BeforeRageLoss],
      apply: ctx => ctx.parent.addModified(50, 0),
    }),
  )
  f.a.settingRage(100)
  f.switchTo()
  expect(f.a.currentRage).toBe(70)
})

it('fresh-catalog checkpoint retains protection and consumes it on resumed switching', async () => {
  const first = fixture()
  const fresh = fixture()
  const catalogFor = (f: ReturnType<typeof fixture>) => {
    const catalog = new SnapshotCatalog('switch-protection/1')
    catalog.registerContent(f.mark.base.id, f.mark.base)
    effectAuthoring.registerEffect(catalog, f.mark.effects[0])
    for (const player of [f.a, f.b])
      for (const pet of player.team) {
        catalog.registerContent(`species:${pet.originalSpecies.id}`, pet.originalSpecies)
        for (const skill of pet.skills) catalog.registerContent(`skill:${skill.baseId}`, skill.base)
      }
    return catalog
  }
  first.a.settingRage(99)
  const ready = new Promise<void>(resolve =>
    first.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = first.battle.startBattle().catch(error => {
    expect(error.message).toBe('Battle cancelled')
  })
  let saved: ReturnType<typeof snapshotBattle>
  try {
    await ready
    saved = JSON.parse(JSON.stringify(snapshotBattle(first.battle, catalogFor(first))))
  } finally {
    await first.battle.cleanup()
    await running
  }
  const restored = restoreBattle(saved, catalogFor(fresh))
  battles.push(restored)
  const outgoing = restored.playerA.activePet
  const mark = outgoing.marks.find(mark => mark.baseId === 'mark_feixuanzhen')!
  const phase = new SwitchPetPhase(restored, restored.playerA, restored.playerA.team[1], new TurnContext(restored))
  phase.initialize()
  phase.execute()
  expect(restored.playerA.currentRage).toBe(99)
  expect(mark.isActive).toBe(false)
  expect(mark.owner).toBeNull()
})
