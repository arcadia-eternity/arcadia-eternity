import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  createConsecutiveFlyingRage,
  effectAuthoring,
  parameterAddress,
  BaseMark,
  BaseSkill,
  SkillInstance,
  SkillPhase,
  UseSkillContext,
  TurnContext,
  Element,
  Category,
  AttackTargetOpinion,
  EffectTrigger,
  BattleMessageType,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const id = 'effect_ability_add_20_rage_when_use_fly_skill_twice'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const effect = createConsecutiveFlyingRage()
  effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const mark = new BaseMark('mark_ability_feixiang' as baseMarkId, [effect], {
    ...f.debuff.config,
    maxStacks: 1,
    persistent: true,
    duration: -1,
    keepOnSwitchOut: true,
  }).createInstance()
  mark.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(mark)
  const skill = (suffix: string, element: Element) => {
    const result = new SkillInstance(
      new BaseSkill(
        `fixture/flying-${suffix}` as baseSkillId,
        Category.Status,
        element,
        0,
        100,
        0,
        0,
        AttackTargetOpinion.opponent,
        1,
        true,
      ),
    )
    result.setOwner(f.a.activePet)
    f.a.activePet.skills.push(result)
    return result
  }
  const fly = skill('one', Element.Flying),
    otherFly = skill('two', Element.Flying),
    normal = skill('normal', Element.Normal)
  f.a.settingRage(0)
  const context = (skill = fly) =>
    new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  const run = (event = context()) => {
    const phase = new SkillPhase(
      f.battle,
      event.origin,
      event.pet,
      event.selectTarget,
      event.skill,
      event.parent,
      event,
    )
    phase.initialize()
    phase.execute()
    return event
  }
  return { ...f, mark, effect, fly, otherFly, normal, context, run }
}
it('first flying use does not award rage; subsequent distinct flying skills do', () => {
  const f = fixture()
  expect(f.run().previousSkillElement).toBeUndefined()
  expect(f.a.currentRage).toBe(0)
  expect(f.run(f.context(f.otherFly)).previousSkillElement).toBe(Element.Flying)
  expect(f.a.currentRage).toBe(20)
  expect(f.a.activePet.lastSkillUsedTimes).toBe(1)
  f.run()
  expect(f.a.currentRage).toBe(40)
})
it('a completed non-flying use breaks the chain', () => {
  const f = fixture()
  f.run()
  f.run(f.context(f.normal))
  f.run()
  expect(f.a.currentRage).toBe(0)
  f.run()
  expect(f.a.currentRage).toBe(20)
})
it('miss counts as a use but does not trigger a hit reward', () => {
  const f = fixture()
  const miss = f.context()
  miss.setSureMiss(100)
  f.run(miss)
  expect(miss.hitResult).toBe(false)
  expect(f.a.currentRage).toBe(0)
  f.run()
  expect(f.a.currentRage).toBe(20)
  const secondMiss = f.context()
  secondMiss.setSureMiss(100)
  f.run(secondMiss)
  expect(f.a.currentRage).toBe(20)
})
for (const failure of ['cancelled', 'no-rage'] as const)
  it(`${failure} attempt does not overwrite completed history`, () => {
    const f = fixture()
    f.run()
    const failed = f.context(f.normal)
    if (failure === 'cancelled') failed.available = false
    else failed.rage = 999
    f.run(failed)
    expect(failed.previousSkillElement).toBeUndefined()
    expect(f.a.activePet.lastUsedSkillElement).toBe(Element.Flying)
    f.run()
    expect(f.a.currentRage).toBe(20)
  })
it('queued contexts capture history on execution rather than construction', () => {
  const f = fixture()
  const first = f.context(),
    second = f.context(f.otherFly)
  f.run(first)
  f.run(second)
  expect(second.previousSkillElement).toBe(Element.Flying)
  expect(f.a.currentRage).toBe(20)
})
it('captures the effective completed element rather than following the skill object', () => {
  const f = fixture()
  const changed = f.context(f.normal)
  changed.element = Element.Flying
  f.run(changed)
  expect(f.normal.element).toBe(Element.Normal)
  expect(f.a.activePet.lastUsedSkillElement).toBe(Element.Flying)
  f.run()
  expect(f.a.currentRage).toBe(20)
})
it('reads current element at hit time and records it at completion', () => {
  const f = fixture()
  f.run()
  f.b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/change-flying' as effectId,
      triggers: [EffectTrigger.BeforeHit],
      apply: ctx => {
        ctx.parent.element = Element.Normal
      },
    }),
  )
  f.run()
  expect(f.a.currentRage).toBe(0)
  expect(f.a.activePet.lastUsedSkillElement).toBe(Element.Normal)
})
it('preserves per-hit triggering and exposes the rage parameter', () => {
  const f = fixture()
  f.run()
  f.battle.configSystem.set(parameterAddress(id, 'parameters', 'rage'), 7)
  const second = f.context()
  second.multihit = 2
  f.run(second)
  expect(f.a.currentRage).toBe(14)
})
it('another actor cannot trigger the owner ability or overwrite its history', () => {
  const f = fixture()
  f.run()
  const other = new UseSkillContext(
    new TurnContext(f.battle),
    f.b,
    f.b.activePet,
    AttackTargetOpinion.opponent,
    f.b.activePet.skills[0],
  )
  other.element = Element.Flying
  other.category = Category.Status
  f.b.activePet.lastUsedSkillElement = Element.Flying
  const before = f.b.currentRage
  f.run(other)
  expect(f.a.currentRage).toBe(0)
  expect(f.b.currentRage).toBe(before - other.skill.rage)
  expect(f.a.activePet.lastUsedSkillElement).toBe(Element.Flying)
})
for (const oldFormat of [false, true])
  it(`restores completed history with fresh definitions; oldFormat=${oldFormat}`, async () => {
    const f = fixture(),
      fresh = fixture()
    const catalogFor = (source: ReturnType<typeof fixture>) => {
      const catalog = new SnapshotCatalog('flying-history/1')
      catalog.registerContent(source.mark.base.id, source.mark.base)
      effectAuthoring.registerEffect(catalog, source.effect)
      for (const player of [source.a, source.b])
        for (const pet of player.team) {
          catalog.registerContent(`species:${pet.originalSpecies.id}`, pet.originalSpecies)
          for (const skill of pet.skills) catalog.registerContent(`skill:${skill.baseId}`, skill.base)
        }
      return catalog
    }
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(message => {
        if (message.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    const running = f.battle.startBattle().catch(error => {
      expect(error.message).toBe('Battle cancelled')
    })
    let saved: ReturnType<typeof snapshotBattle>
    try {
      await ready
      f.run()
      saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalogFor(f))))
    } finally {
      await f.battle.cleanup()
      await running
    }
    if (oldFormat) for (const node of saved.nodes) if (node.kind === 'Pet') delete node.fields.lastUsedSkillElement
    const restored = restoreBattle(saved, catalogFor(fresh))
    battles.push(restored)
    const player = restored.playerA,
      pet = player.activePet
    expect(pet.lastUsedSkillElement).toBe(oldFormat ? undefined : Element.Flying)
    const next = pet.skills.find(skill => skill.baseId === 'fixture/flying-two')!
    const phase = new SkillPhase(restored, player, pet, AttackTargetOpinion.opponent, next, new TurnContext(restored))
    phase.initialize()
    phase.execute()
    expect(player.currentRage).toBe(oldFormat ? 0 : 20)
  })

for (const failure of ['cancelled', 'no-rage'] as const)
  it(`${failure} first attempt cannot seed a consecutive reward`, () => {
    const f = fixture()
    const failed = f.context()
    if (failure === 'cancelled') failed.available = false
    else failed.rage = 999
    f.run(failed)
    expect(f.a.activePet.lastUsedSkillElement).toBeUndefined()
    f.run()
    expect(f.a.currentRage).toBe(0)
  })
