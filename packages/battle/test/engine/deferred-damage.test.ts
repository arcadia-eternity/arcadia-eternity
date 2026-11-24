import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  removeMark,
  transferMarks,
  BaseMark,
  BaseSkill,
  Category,
  BattleMessageType,
  DamageContext,
  DamageType,
  defineNativeEffect,
  EffectTrigger,
  Element,
  RemoveMarkContext,
  StackStrategy,
  SwitchPetContext,
  TurnContext,
  TransformContext,
  TransformPhase,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type BattleMessage,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/engine'
import { compileEffect, contexts, ops } from '@arcadia-eternity/battle/authoring'
import { makeDeferredScenario, advanceDeferredTurn } from './deferred-scenario'
import { catalogFor } from './snapshot-host'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function fixture(options?: Parameters<typeof makeDeferredScenario>[0]) {
  const f = makeDeferredScenario(options)
  battles.push(f.battle)
  const messages: BattleMessage[] = []
  f.battle.registerListener(m => messages.push(m))
  const damages = () => messages.filter(m => m.type === BattleMessageType.Damage)
  return { ...f, messages, damages }
}

it('pays once, waits for the end of the third turn, and hits the new occupant from the original benched caster', () => {
  const { battle, a, b, skill, mark, damages, messages } = fixture({ hits: 2 })
  const caster = a.activePet
  const originalTarget = b.activePet
  const initialHp = originalTarget.currentHp
  advanceDeferredTurn(battle, 'cast')
  expect(damages()).toHaveLength(0)
  expect(battle.marks).toHaveLength(1)
  const holder = battle.marks[0]
  expect(holder.owner).toBe(battle)
  expect(holder.base).toBe(mark)
  expect(holder.deferredDamage).toMatchObject({
    origin: { petId: caster.id, skillId: skill.baseId, skillInstanceId: skill.id },
    target: { kind: 'active', playerId: b.id },
    evaluation: 'on-trigger',
  })
  const pending = holder.deferredDamage!
  const observed: DamageContext[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/delayed-result-observer' as effectId,
      triggers: [EffectTrigger.PostDamage],
      apply: ctx => {
        observed.push(ctx.parent)
      },
    }),
  )
  advanceDeferredTurn(battle, 'switch', 'switch')
  expect(holder.isActive).toBe(true)
  expect(damages()).toHaveLength(0)
  advanceDeferredTurn(battle)
  expect(damages()).toHaveLength(1)
  expect(damages()[0].data).toMatchObject({
    source: skill.id,
    target: b.activePet.id,
    damageType: DamageType.Special,
  })
  expect(damages()[0].data.damage).toBeGreaterThan(0)
  expect(observed).toHaveLength(1)
  expect(observed[0].result).toMatchObject({
    status: 'committed',
    causeId: pending.id,
    targetId: b.activePet.id,
    origin: {
      trigger: 'deferred',
      petId: caster.id,
      skillId: skill.baseId,
      skillInstanceId: skill.id,
      holderId: holder.id,
    },
    hpLoss: damages()[0].data.damage,
  })
  expect(originalTarget.currentHp).toBe(initialHp)
  expect(holder.isActive).toBe(false)
  const turnThree = messages.slice(messages.findIndex(m => m.type === BattleMessageType.TurnStart && m.data.turn === 3))
  const turnRage = turnThree.findIndex(m => m.type === BattleMessageType.RageChange && m.data.reason === 'turn')
  const damage = turnThree.findIndex(m => m.type === BattleMessageType.Damage)
  const ended = turnThree.findIndex(m => m.type === BattleMessageType.TurnEnd)
  expect(turnRage).toBeGreaterThanOrEqual(0)
  expect(damage).toBeGreaterThan(turnRage)
  expect(ended).toBeGreaterThan(damage)
  advanceDeferredTurn(battle)
  expect(damages()).toHaveLength(1)
  expect(messages.filter(m => m.type === BattleMessageType.SkillUse)).toHaveLength(1)
  expect(messages.filter(m => m.type === BattleMessageType.RageChange && m.data.reason === 'skill')).toHaveLength(1)
  expect(caster.lastSkillUsedTimes).toBe(1)
})

it('consumes a successful cast when its mark application is prevented', () => {
  const f = fixture()
  f.b.activePet.skills[0].effects.push(
    compileEffect({
      id: 'fixture/reject-future-sight',
      triggers: [EffectTrigger.OnBeforeAddMark],
      apply: contexts.addMark.apply(ops.disableContext()),
    }),
  )
  advanceDeferredTurn(f.battle, 'cast')
  expect(f.battle.marks).toHaveLength(0)
  advanceDeferredTurn(f.battle)
  advanceDeferredTurn(f.battle)
  expect(f.damages()).toHaveLength(0)
  expect(f.messages.filter(m => m.type === BattleMessageType.RageChange && m.data.reason === 'skill')).toHaveLength(1)
})

function damageWith(change?: (state: ReturnType<typeof fixture>) => void, capturePower = false) {
  const f = fixture({ capturePower })
  advanceDeferredTurn(f.battle, 'cast')
  change?.(f)
  advanceDeferredTurn(f.battle)
  advanceDeferredTurn(f.battle)
  expect(f.damages()).toHaveLength(1)
  return f.damages()[0].data
}

it('reads special attack, special defense, and the element matchup on the expiry turn', () => {
  const normal = damageWith().damage
  expect(damageWith(f => f.a.activePet.attributeSystem.updateBaseValue('spa', 180)).damage).toBeGreaterThan(normal)
  expect(damageWith(f => f.b.activePet.attributeSystem.updateBaseValue('spd', 220)).damage).toBeLessThan(normal)
  const resisted = damageWith(f => {
    f.b.activePet.element = Element.Water
  })
  expect(resisted.effectiveness).toBeLessThan(1)
  expect(resisted.damage).toBeLessThan(normal)
})

it('uses live power by default and supports explicitly capturing only power on cast', () => {
  const base = damageWith().damage
  const doublePower = (f: ReturnType<typeof fixture>) => {
    f.skill.power *= 2
  }
  expect(damageWith(doublePower).damage).toBeGreaterThan(base)
  expect(damageWith(doublePower, true).damage).toBe(base)
})

it('preserves the cast skill definition if the skill instance transforms before expiry', () => {
  const baseline = damageWith()
  const result = damageWith(f => {
    const changedSkill = new BaseSkill.Builder()
      .withID('fixture/transformed')
      .withSkillType(Category.Physical)
      .withType(Element.Water)
      .withPower(200)
      .withTag('fixture/transformed')
      .build()
    const phase = new TransformPhase(
      new TransformContext(f.battle, f.skill, 'skill', f.skill.base, changedSkill, 'permanent', 0),
    )
    f.battle.phaseManager.run(phase)
    expect(f.skill.baseId).toBe('fixture/transformed')
  })
  expect(result.damage).toBe(baseline.damage)
  expect(result.damageType).toBe(DamageType.Special)
  expect(result.result).toMatchObject({
    intent: { element: Element.Fire },
    origin: {
      skillId: 'fixture/future-sight',
      skillCategory: Category.Special,
      skillElement: Element.Fire,
      skillTags: ['fixture/foresight'],
      hitCount: 1,
    },
  })
})

it('applies damage modifiers and shields installed after the cast', () => {
  const base = damageWith().damage
  const changed = damageWith(f => {
    f.b.activePet.skills[0].effects.push(
      compileEffect({
        id: 'fixture/late-bonus',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: 10 })),
      }),
    )
    const shield = new BaseMark('fixture/late-shield' as baseMarkId, [], {
      ...f.mark.config,
      isShield: true,
      maxStacks: 3,
      persistent: true,
    }).createInstance({ stack: 3 })
    shield.setOwner(f.b.activePet, f.battle.emitter)
    f.b.activePet.marks.push(shield)
  })
  expect(changed.damage).toBe(base + 7)
})

it('transfers one pending descriptor while preserving its original target position', () => {
  const f = fixture()
  advanceDeferredTurn(f.battle, 'cast')
  const holder = f.battle.marks[0]
  const pending = holder.deferredDamage
  const transfer = new SwitchPetContext(new TurnContext(f.battle), f.a, f.a.activePet)
  transferMarks(transfer, f.a.activePet, holder)
  expect(f.battle.marks).toHaveLength(0)
  expect(f.a.activePet.marks).toContain(holder)
  expect(holder.deferredDamage).toBe(pending)
  advanceDeferredTurn(f.battle, 'wait', 'switch')
  advanceDeferredTurn(f.battle)
  advanceDeferredTurn(f.battle)
  expect(f.damages()).toHaveLength(1)
  expect(f.damages()[0].data.target).toBe(f.b.team[1].id)
})

it.each(['remove', 'suppress'] as const)('discards a pending strike on %s', mode => {
  const f = fixture()
  advanceDeferredTurn(f.battle, 'cast')
  const mark = f.battle.marks[0]
  if (mode === 'remove') removeMark(new RemoveMarkContext(new TurnContext(f.battle), mark))
  else mark.isSuppressed = true
  for (let i = 0; i < 4; i++) advanceDeferredTurn(f.battle)
  expect(f.damages()).toHaveLength(0)
  expect(f.battle.marks).toHaveLength(0)
})

it('keeps simultaneous casts on opposite field positions independent', () => {
  const f = fixture()
  const opposingSkill = f.b.activePet.skills[0]
  opposingSkill.effects.push(...f.skill.effects)
  f.b.currentRage = f.b.maxRage
  advanceDeferredTurn(f.battle, 'cast', 'cast')
  expect(f.battle.marks.map(m => m.deferredDamage?.target.playerId).sort()).toEqual([f.a.id, f.b.id])
  expect(f.damages()).toHaveLength(0)
  advanceDeferredTurn(f.battle)
  advanceDeferredTurn(f.battle)
  expect(f.damages().map(m => [m.data.source, m.data.target])).toEqual(
    expect.arrayContaining([
      [f.skill.id, f.b.activePet.id],
      [opposingSkill.id, f.a.activePet.id],
    ]),
  )
  expect(f.damages()).toHaveLength(2)
})

it.each([StackStrategy.stack, StackStrategy.refresh, StackStrategy.replace])(
  'applies %s to a second cast from another caster without duplicating the strike',
  stackStrategy => {
    const f = fixture({ stackStrategy })
    const backupSkill = f.a.team[1].skills[0]
    backupSkill.effects.push(...f.skill.effects)
    advanceDeferredTurn(f.battle, 'cast')
    const first = f.battle.marks[0].deferredDamage!
    advanceDeferredTurn(f.battle, 'switch')
    advanceDeferredTurn(f.battle, 'cast')
    expect(f.battle.marks).toHaveLength(1)
    const second = f.battle.marks[0].deferredDamage!
    if (stackStrategy === StackStrategy.replace) {
      expect(second.id).not.toBe(first.id)
      expect(second.origin.petId).toBe(f.a.team[1].id)
    } else expect(second).toBe(first)
    for (let i = 0; i < 4; i++) advanceDeferredTurn(f.battle)
    expect(f.damages()).toHaveLength(1)
    expect(f.damages()[0].data.source).toBe(stackStrategy === StackStrategy.replace ? backupSkill.id : f.skill.id)
    expect(f.battle.marks).toHaveLength(0)
  },
)

it.each([
  ['any', true, 1],
  ['alive', true, 0],
  ['alive', false, 1],
  ['active', false, 0],
] as const)('applies source policy %s with a benched caster (fainted=%s)', (sourcePolicy, fainted, count) => {
  const f = fixture({ sourcePolicy })
  const caster = f.a.activePet
  advanceDeferredTurn(f.battle, 'cast')
  advanceDeferredTurn(f.battle, 'switch')
  if (fainted) {
    caster.currentHp = 0
    caster.isAlive = false
  }
  advanceDeferredTurn(f.battle)
  expect(f.damages()).toHaveLength(count)
})

function nextPrompt(battle: Battle) {
  return new Promise<void>(resolve => {
    const ready = (m: BattleMessage) => {
      if (m.type !== BattleMessageType.TurnAction) return
      battle.unregisterListener(ready)
      resolve()
    }
    battle.registerListener(ready)
  })
}

async function submitTurn(battle: Battle, cast: boolean) {
  const ready = nextPrompt(battle)
  for (const player of [battle.playerA, battle.playerB]) {
    const action = battle
      .getAvailableSelection(player.id)
      .find(s => s.type === (cast && player === battle.playerA ? 'use-skill' : 'switch-pet'))
    expect(action).toBeDefined()
    expect(battle.setSelection(action!)).toBe(true)
  }
  await ready
}

it('restores a pending mark across a real selection checkpoint and produces the same resolution', async () => {
  const f = fixture()
  const catalog = catalogFor(f).registerContent('mark:' + f.mark.id, f.mark)
  const ready = nextPrompt(f.battle)
  const original = f.battle.startBattle().catch(error => {
    if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
  })
  await ready
  await submitTurn(f.battle, true)
  expect(f.battle.marks).toHaveLength(1)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  const originalId = f.battle.marks[0].id
  const pending = f.battle.marks[0].deferredDamage
  await submitTurn(f.battle, false)
  await submitTurn(f.battle, false)
  expect(f.battle.marks).toHaveLength(0)
  expect(f.damages()).toHaveLength(1)
  const expected = f.damages()[0].data
  const hp = f.b.activePet.currentHp
  await f.battle.cleanup()
  await original

  const fresh = fixture()
  const freshCatalog = catalogFor(fresh).registerContent('mark:' + fresh.mark.id, fresh.mark)
  const restored = restoreBattle(saved, freshCatalog)
  battles.push(restored)
  expect(restored.marks[0].deferredDamage).toEqual(pending)
  expect(restored.marks[0].id).toBe(originalId)
  const results: (typeof expected)[] = []
  restored.registerListener(m => {
    if (m.type === BattleMessageType.Damage) results.push(m.data)
  })
  const resumed = restored.resumeBattle().catch(error => {
    if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
  })
  try {
    await submitTurn(restored, false)
    await submitTurn(restored, false)
    expect(restored.marks).toHaveLength(0)
    expect(results).toEqual([expected])
    expect(restored.playerB.activePet.currentHp).toBe(hp)
  } finally {
    await restored.cleanup()
    await resumed
  }
})
