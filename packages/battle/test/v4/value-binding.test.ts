import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AddMarkContext,
  BaseMark,
  Effect,
  EffectContext,
  EffectTrigger,
  Signal,
  SwitchPetPhase,
  TurnContext,
  defineValue,
  select,
  values,
  installValueModifier,
  setGlobalLogger,
  type Battle,
  type Player,
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
  const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  const base = new BaseMark('binding/source' as baseMarkId, [], {
    ...f.debuff.config,
    persistent: true,
    destroyable: true,
    keepOnSwitchOut: true,
  })
  f.battle.addMark(new AddMarkContext(ctx, f.a.activePet, base))
  return { ...f, source: f.a.activePet.marks[0] }
}
function switchTo(battle: Battle, player: Player, index: number) {
  const phase = new SwitchPetPhase(battle, player, player.team[index], new TurnContext(battle))
  phase.initialize()
  expect(phase.execute().success).toBe(true)
}

it('captures defense per entry while following the slot and multiplier through real V4 switches', () => {
  const { battle, a, b, source } = fixture()
  b.team[0].attributeSystem.updateBaseValue('def', 40)
  b.team[1].attributeSystem.updateBaseValue('def', 80)
  const ratio = new Signal(2)
  const definition = defineValue('test/entry-defense', (args: { opponent: Player; ratio: Signal<number> }) =>
    values.combine(
      {
        defense: select
          .activePet(args.opponent, { key: 'target', mode: 'follow' })
          .attribute('def', { key: 'def', mode: 'capture', captureScope: 'input' })
          .requireOne(),
        ratio: values.reactive(args.ratio),
      },
      ({ defense, ratio }) => defense * ratio,
    ),
  )
  installValueModifier({
    definition,
    args: { opponent: b, ratio },
    source,
    effectId: 'test/effect',
    bindingKey: 'attack',
    target: a.activePet,
    attribute: 'atk',
    operation: 'override',
  })
  expect(a.activePet.stat.atk).toBe(80)
  b.team[0].attributeSystem.updateBaseValue('def', 60)
  expect(a.activePet.stat.atk).toBe(80)
  ratio.next(3)
  expect(a.activePet.stat.atk).toBe(120)
  switchTo(battle, b, 1)
  expect(a.activePet.stat.atk).toBe(240)
  b.team[1].attributeSystem.updateBaseValue('def', 100)
  b.team[0].attributeSystem.updateBaseValue('def', 70)
  // No reads or UI subscribers between these structural transitions.
  switchTo(battle, b, 0)
  expect(a.activePet.stat.atk).toBe(210)
})

it.each([
  ['capture', 'capture', [40, 40, 40, 40, 40, 40]],
  ['capture', 'follow', [40, 60, 60, 60, 70, 70]],
  ['follow', 'capture', [40, 40, 80, 80, 80, 70]],
  ['follow', 'follow', [40, 60, 80, 100, 100, 70]],
] as const)('keeps object=%s and attribute=%s independent', (objectMode, attributeMode, expected) => {
  const { battle, a, b, source } = fixture()
  b.team[0].attributeSystem.updateBaseValue('def', 40)
  b.team[1].attributeSystem.updateBaseValue('def', 80)
  const definition = defineValue('test/matrix', (player: Player) =>
    select
      .activePet(
        player,
        objectMode === 'follow'
          ? { key: 'target', mode: 'follow' }
          : { key: 'target', mode: 'capture', captureScope: 'binding' },
      )
      .attribute(
        'def',
        attributeMode === 'follow'
          ? { key: 'def', mode: 'follow' }
          : { key: 'def', mode: 'capture', captureScope: 'input' },
      )
      .requireOne(),
  )
  installValueModifier({
    definition,
    args: b,
    source,
    effectId: 'matrix',
    bindingKey: 'attack',
    target: a.activePet,
    attribute: 'atk',
    operation: 'override',
  })
  const actual = [a.activePet.stat.atk]
  b.team[0].attributeSystem.updateBaseValue('def', 60)
  actual.push(a.activePet.stat.atk)
  switchTo(battle, b, 1)
  actual.push(a.activePet.stat.atk)
  b.team[1].attributeSystem.updateBaseValue('def', 100)
  actual.push(a.activePet.stat.atk)
  b.team[0].attributeSystem.updateBaseValue('def', 70)
  actual.push(a.activePet.stat.atk)
  switchTo(battle, b, 0)
  actual.push(a.activePet.stat.atk)
  expect(actual).toEqual(expected)
})

it('replaces one target contribution, preserves it on preparation failure, and cleans source bindings', async () => {
  const { a, b, source, battle } = fixture()
  const ratio = new Signal(2)
  const definition = defineValue('replace', (factor: Signal<number>) => values.reactive(factor))
  const options = {
    definition,
    args: ratio,
    source,
    effectId: 'replace',
    bindingKey: 'amount',
    target: a.activePet,
    attribute: 'atk' as const,
    operation: 'delta' as const,
  }
  const old = installValueModifier(options)
  expect(a.activePet.stat.atk).toBe(57)
  installValueModifier({ ...options, args: new Signal(7) })
  expect(a.activePet.stat.atk).toBe(62)
  expect(old.isDisposed).toBe(true)
  old.dispose()
  expect(a.activePet.stat.atk).toBe(62)
  expect(() => installValueModifier({ ...options, args: new Signal(Infinity) })).toThrow('finite')
  expect(a.activePet.stat.atk).toBe(62)
  installValueModifier({ ...options, target: a.team[1], args: new Signal(3) })
  expect(a.team[1].stat.atk).toBe(58)
  const { RemoveMarkContext } = await import('@arcadia-eternity/battle/v4')
  battle.removeMark(new RemoveMarkContext(new TurnContext(battle), source))
  expect(a.team[0].stat.atk).toBe(55)
  expect(a.team[1].stat.atk).toBe(55)
  ratio.next(100)
  expect(a.team[0].stat.atk).toBe(55)
  expect(b.activePet.isAlive).toBe(true)
})

it('restores captures and structural tracking before any read, without replaying effects', async () => {
  const { SnapshotCatalog, snapshotBattle, restoreBattle, BattleMessageType, RemoveMarkContext } =
    await import('@arcadia-eternity/battle/v4')
  const { battle, a, b, source, debuff } = fixture()
  const ready = new Promise<void>(resolve =>
    battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = battle.startBattle().catch(() => {})
  await ready
  b.team[0].attributeSystem.updateBaseValue('def', 40)
  b.team[1].attributeSystem.updateBaseValue('def', 80)
  const definition = defineValue('snapshot/defense', (opponent: Player) =>
    select
      .activePet(opponent, { key: 'target', mode: 'follow' })
      .attribute('def', { key: 'def', mode: 'capture', captureScope: 'input' })
      .requireOne(),
  )
  installValueModifier({
    definition,
    args: b,
    source,
    target: a.activePet,
    attribute: 'atk',
    operation: 'override',
    effectId: 'snapshot-effect',
    bindingKey: 'attack',
  })
  b.activePet.attributeSystem.updateBaseValue('def', 60)
  const catalog = new SnapshotCatalog('binding/1').registerValueBinding(definition)
  for (const pet of [...a.team, ...b.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of debuff.effects) catalog.registerEffect(effect.id, effect)
  const payload = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  const expectedDraw = battle.random()
  await battle.cleanup()
  await run
  const catalogWithoutValue = new SnapshotCatalog('binding/1')
  for (const pet of [...a.team, ...b.team])
    for (const skill of pet.skills)
      for (const effect of skill.effects) catalogWithoutValue.registerEffect(effect.id, effect)
  for (const effect of debuff.effects) catalogWithoutValue.registerEffect(effect.id, effect)
  expect(() => restoreBattle(payload, catalogWithoutValue)).toThrow('Missing value binding definition')
  const changedDefinition = defineValue(definition.id, (opponent: Player) =>
    select
      .activePet(opponent, { key: 'target', mode: 'follow' })
      .attribute('def', { key: 'renamed-node', mode: 'capture', captureScope: 'input' })
      .requireOne(),
  )
  catalogWithoutValue.registerValueBinding(changedDefinition)
  expect(() => restoreBattle(payload, catalogWithoutValue)).toThrow('Missing or mismatched capture')
  const restored = restoreBattle(payload, catalog)
  battles.push(restored)
  expect(restored.random()).toBe(expectedDraw)
  expect(restored.playerA.activePet.stat.atk).toBe(40)
  switchTo(restored, restored.playerB, 1)
  restored.playerB.team[0].attributeSystem.updateBaseValue('def', 70)
  switchTo(restored, restored.playerB, 0)
  // No reads between switch transitions, including after restore.
  expect(restored.playerA.activePet.stat.atk).toBe(70)
  const second = JSON.parse(JSON.stringify(snapshotBattle(restored, catalog)))
  await restored.cleanup()
  const twice = restoreBattle(second, catalog)
  battles.push(twice)
  expect(twice.playerA.activePet.stat.atk).toBe(70)
  const restoredSource = twice.playerA.activePet.marks.find(mark => mark.id === source.id)!
  twice.removeMark(new RemoveMarkContext(new TurnContext(twice), restoredSource))
  expect(twice.playerA.activePet.stat.atk).toBe(55)
})

it('withdraws a faulted contribution, recovers on valid input, and disposes its listeners', () => {
  const { a, source } = fixture()
  const amount = new Signal(5)
  const definition = defineValue('fault', (input: Signal<number>) => values.reactive(input))
  const bound = installValueModifier({
    definition,
    args: amount,
    source,
    target: a.activePet,
    attribute: 'atk',
    operation: 'delta',
    effectId: 'fault',
    bindingKey: 'atk',
  })
  expect(a.activePet.stat.atk).toBe(60)
  expect(() => amount.next(Infinity)).not.toThrow()
  expect(a.activePet.stat.atk).toBe(55)
  amount.next(9)
  expect(a.activePet.stat.atk).toBe(64)
  bound.dispose()
  bound.dispose()
  expect(a.activePet.stat.atk).toBe(55)
  expect(amount.observerCount).toBe(0)
  expect(a.activePet.attributeSystem.getMemoryStats().modifierCount).toBe(0)
})

it('tracks entries during suppression without recapturing on unsuppression', () => {
  const { battle, a, b, source } = fixture()
  b.team[0].attributeSystem.updateBaseValue('def', 40)
  b.team[1].attributeSystem.updateBaseValue('def', 80)
  const definition = defineValue('suppression', (opponent: Player) =>
    select
      .activePet(opponent, { key: 'pet', mode: 'follow' })
      .attribute('def', { key: 'def', mode: 'capture', captureScope: 'input' })
      .requireOne(),
  )
  installValueModifier({
    definition,
    args: b,
    source,
    target: a.activePet,
    attribute: 'atk',
    operation: 'override',
    effectId: 'suppress',
    bindingKey: 'atk',
  })
  source.isSuppressed = true
  expect(a.activePet.stat.atk).toBe(55)
  switchTo(battle, b, 1)
  b.activePet.attributeSystem.updateBaseValue('def', 100)
  source.isSuppressed = false
  expect(a.activePet.stat.atk).toBe(80)
})

it('rejects self and transitive cycles before publishing a contribution', () => {
  const { a, b, source } = fixture()
  const definition = defineValue('cycle', (player: Player) =>
    select
      .activePet(player, { key: 'pet', mode: 'follow' })
      .attribute('atk', { key: 'atk', mode: 'follow' })
      .requireOne(),
  )
  const options = {
    definition,
    args: a,
    source,
    target: a.activePet,
    attribute: 'atk' as const,
    operation: 'delta' as const,
    effectId: 'cycle',
    bindingKey: 'atk',
  }
  expect(() => installValueModifier(options)).toThrow(/Circular/)
  expect(a.activePet.stat.atk).toBe(55)
  installValueModifier({ ...options, args: b })
  const before = a.activePet.stat.atk
  expect(() => installValueModifier({ ...options, target: b.activePet, bindingKey: 'other' })).toThrow(/Circular/)
  expect(a.activePet.stat.atk).toBe(before)
})

it('withdraws a dynamically cyclic contribution and recovers after the slot changes', () => {
  const { battle, a, source } = fixture()
  const definition = defineValue('dynamic-cycle', (player: Player) =>
    select
      .activePet(player, { key: 'pet', mode: 'follow' })
      .attribute('atk', { key: 'atk', mode: 'follow' })
      .requireOne(),
  )
  installValueModifier({
    definition,
    args: a,
    source,
    target: a.team[1],
    attribute: 'atk',
    operation: 'delta',
    effectId: 'cycle',
    bindingKey: 'atk',
  })
  expect(a.team[1].stat.atk).toBe(110)
  expect(() => switchTo(battle, a, 1)).not.toThrow()
  expect(a.team[1].stat.atk).toBe(55)
  expect(() => switchTo(battle, a, 0)).not.toThrow()
  expect(a.team[1].stat.atk).toBe(110)
})

it('keeps a failed input capture faulted until a new entry and permits a shared selection', () => {
  const { battle, a, b, source } = fixture()
  b.team[0].attributeSystem.updateBaseValue('def', 40)
  b.team[1].attributeSystem.updateBaseValue('def', Infinity)
  const ratio = new Signal(1)
  const definition = defineValue('entry-fault', (input: { player: Player; ratio: Signal<number> }) => {
    const pet = select.activePet(input.player, { key: 'pet', mode: 'follow' })
    return values.combine(
      {
        captured: pet.attribute('def', { key: 'capture', mode: 'capture', captureScope: 'input' }).requireOne(),
        live: pet.attribute('spa', { key: 'live', mode: 'follow' }).requireOne(),
        ratio: values.reactive(input.ratio),
      },
      ({ captured, live, ratio }) => captured * ratio + live * 0,
    )
  })
  installValueModifier({
    definition,
    args: { player: b, ratio },
    source,
    target: a.activePet,
    attribute: 'atk',
    operation: 'override',
    effectId: 'entry',
    bindingKey: 'atk',
  })
  expect(a.activePet.stat.atk).toBe(40)
  switchTo(battle, b, 1)
  expect(a.activePet.stat.atk).toBe(55)
  b.activePet.attributeSystem.updateBaseValue('def', 80)
  ratio.next(2)
  expect(a.activePet.stat.atk).toBe(55)
  switchTo(battle, b, 0)
  switchTo(battle, b, 1)
  expect(a.activePet.stat.atk).toBe(160)
})

it('allows a frozen self read and rejects foreign contribution ownership', () => {
  const { a, source } = fixture()
  const other = fixture()
  const definition = defineValue('self-capture', (player: Player) =>
    select
      .activePet(player, { key: 'pet', mode: 'follow' })
      .attribute('atk', { key: 'atk', mode: 'capture', captureScope: 'binding' })
      .requireOne(),
  )
  const options = {
    definition,
    args: a,
    source,
    target: a.activePet,
    attribute: 'atk' as const,
    operation: 'delta' as const,
    effectId: 'capture',
    bindingKey: 'atk',
  }
  installValueModifier(options)
  expect(a.activePet.stat.atk).toBe(110)
  a.activePet.attributeSystem.updateBaseValue('atk', 60)
  expect(a.activePet.stat.atk).toBe(115)
  expect(() => installValueModifier({ ...options, target: other.a.activePet })).toThrow('Cross-battle')
  expect(other.a.activePet.stat.atk).toBe(55)
})

it('publishes the new value before switch messages and switch-in hooks without replaying apply', async () => {
  const { BattleMessageType } = await import('@arcadia-eternity/battle/v4')
  const { battle, a, b, source } = fixture()
  b.team[0].attributeSystem.updateBaseValue('def', 40)
  b.team[1].attributeSystem.updateBaseValue('def', 80)
  const seen: [string, number][] = []
  let applications = 0
  const definition = defineValue('hook-order', (player: Player) =>
    select
      .activePet(player, { key: 'pet', mode: 'follow' })
      .attribute('def', { key: 'def', mode: 'follow' })
      .requireOne(),
  )
  source.effects.push(
    new Effect<EffectTrigger>(
      'hook/install' as effectId,
      [EffectTrigger.TurnStart],
      () => {
        applications++
        installValueModifier({
          definition,
          args: b,
          source,
          target: a.activePet,
          attribute: 'atk',
          operation: 'override',
          effectId: 'hook/install',
          bindingKey: 'atk',
        })
      },
      0,
    ),
    new Effect<EffectTrigger>(
      'hook/out' as effectId,
      [EffectTrigger.OnSwitchOut],
      () => seen.push(['out', a.activePet.stat.atk]),
      0,
    ),
    new Effect<EffectTrigger>(
      'hook/in' as effectId,
      [EffectTrigger.OnSwitchIn],
      () => seen.push(['in', a.activePet.stat.atk]),
      0,
    ),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.PetSwitch) seen.push(['message', a.activePet.stat.atk])
  })
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart, source)
  switchTo(battle, b, 1)
  expect(seen).toEqual([
    ['out', 40],
    ['message', 80],
    ['in', 80],
  ])
  b.activePet.attributeSystem.updateBaseValue('def', 100)
  expect(a.activePet.stat.atk).toBe(100)
  expect(applications).toBe(1)
})
